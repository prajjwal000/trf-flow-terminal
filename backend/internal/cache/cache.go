package cache

import (
	"bytes"
	"context"
	"crypto/md5"
	"encoding/json"
	"fmt"
	"sort"
	"strings"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/s3"
)

type Client struct {
	s3       *s3.Client
	bucket   string
	bucketMs int64
}

func New(s3Client *s3.Client, bucket string, bucketMs int64) *Client {
	return &Client{s3: s3Client, bucket: bucket, bucketMs: bucketMs}
}

func tickerHash(tickers []string) string {
	sorted := make([]string, len(tickers))
	copy(sorted, tickers)
	sort.Strings(sorted)
	raw := strings.Join(sorted, ",")
	return fmt.Sprintf("%x", md5.Sum([]byte(raw)))
}

func (c *Client) baseKey(tickers []string, start time.Time) string {
	hash := tickerHash(tickers)
	date := start.Format("2006-01-02")
	return fmt.Sprintf("cache/%s/%s/%d", hash, date, c.bucketMs)
}

func (c *Client) chunkKey(tickers []string, start, end time.Time, offset int) string {
	base := c.baseKey(tickers, start)
	winStart := start.Format("150405")
	winEnd := end.Format("150405")
	return fmt.Sprintf("%s/%s-%s/chunks/%06d.json", base, winStart, winEnd, offset)
}

func (c *Client) fullKey(tickers []string, start, end time.Time) string {
	base := c.baseKey(tickers, start)
	winStart := start.Format("150405")
	winEnd := end.Format("150405")
	return fmt.Sprintf("%s/%s-%s/final.json", base, winStart, winEnd)
}

func (c *Client) metaKey(tickers []string, start, end time.Time) string {
	base := c.baseKey(tickers, start)
	winStart := start.Format("150405")
	winEnd := end.Format("150405")
	return fmt.Sprintf("%s/%s-%s/meta.json", base, winStart, winEnd)
}

type SliceMeta struct {
	FetchedOffsets []int `json:"fetched_offsets"`
	Complete       bool  `json:"complete"`
}

func (c *Client) GetFull(ctx context.Context, tickers []string, start, end time.Time) ([]byte, error) {
	out, err := c.s3.GetObject(ctx, &s3.GetObjectInput{
		Bucket: aws.String(c.bucket),
		Key:    aws.String(c.fullKey(tickers, start, end)),
	})
	if err != nil {
		return nil, err
	}
	defer out.Body.Close()
	buf := new(bytes.Buffer)
	_, err = buf.ReadFrom(out.Body)
	return buf.Bytes(), err
}

func (c *Client) SetFull(ctx context.Context, tickers []string, start, end time.Time, data []byte) error {
	_, err := c.s3.PutObject(ctx, &s3.PutObjectInput{
		Bucket: aws.String(c.bucket),
		Key:    aws.String(c.fullKey(tickers, start, end)),
		Body:   bytes.NewReader(data),
	})
	return err
}

func (c *Client) GetMeta(ctx context.Context, tickers []string, start, end time.Time) (*SliceMeta, error) {
	out, err := c.s3.GetObject(ctx, &s3.GetObjectInput{
		Bucket: aws.String(c.bucket),
		Key:    aws.String(c.metaKey(tickers, start, end)),
	})
	if err != nil {
		return nil, err
	}
	defer out.Body.Close()
	var m SliceMeta
	if err := json.NewDecoder(out.Body).Decode(&m); err != nil {
		return nil, err
	}
	return &m, nil
}

func (c *Client) SetMeta(ctx context.Context, tickers []string, start, end time.Time, m *SliceMeta) error {
	body, err := json.Marshal(m)
	if err != nil {
		return err
	}
	_, err = c.s3.PutObject(ctx, &s3.PutObjectInput{
		Bucket: aws.String(c.bucket),
		Key:    aws.String(c.metaKey(tickers, start, end)),
		Body:   bytes.NewReader(body),
	})
	return err
}

func (c *Client) GetChunk(ctx context.Context, tickers []string, start, end time.Time, offset int) ([]byte, error) {
	out, err := c.s3.GetObject(ctx, &s3.GetObjectInput{
		Bucket: aws.String(c.bucket),
		Key:    aws.String(c.chunkKey(tickers, start, end, offset)),
	})
	if err != nil {
		return nil, err
	}
	defer out.Body.Close()
	buf := new(bytes.Buffer)
	_, err = buf.ReadFrom(out.Body)
	return buf.Bytes(), err
}

func (c *Client) SetChunk(ctx context.Context, tickers []string, start, end time.Time, offset int, data []byte) error {
	_, err := c.s3.PutObject(ctx, &s3.PutObjectInput{
		Bucket: aws.String(c.bucket),
		Key:    aws.String(c.chunkKey(tickers, start, end, offset)),
		Body:   bytes.NewReader(data),
	})
	return err
}
