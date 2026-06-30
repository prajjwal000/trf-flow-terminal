package bucket

import "math"

type Bucket struct {
	Epoch          int64 `json:"t"`
	BucketMs       int64 `json:"bms"`
	LitVol         int64 `json:"lv"`
	DarkRetailVol  int64 `json:"drv"`
	DarkInstVol    int64 `json:"div"`
	DarkBlockVol   int64 `json:"dbv"`
	DarkBlockCount int   `json:"dbc"`
}

func SelectSize() int64 {
	return 500
}

func Align(tradeEpochMs int64, bucketMs int64) int64 {
	return (tradeEpochMs / bucketMs) * bucketMs
}

type Aggregator struct {
	buckets  map[int64]*Bucket
	bucketMs int64
}

func NewAggregator(bucketMs int64) *Aggregator {
	return &Aggregator{
		buckets:  make(map[int64]*Bucket),
		bucketMs: bucketMs,
	}
}

func (a *Aggregator) Add(tradeEpochMs int64, litVol int64, darkRetailVol int64, darkInstVol int64, darkBlockVol int64, darkBlockCount int) {
	key := Align(tradeEpochMs, a.bucketMs)
	b, ok := a.buckets[key]
	if !ok {
		b = &Bucket{
			Epoch:    key,
			BucketMs: a.bucketMs,
		}
		a.buckets[key] = b
	}
	b.LitVol += litVol
	b.DarkRetailVol += darkRetailVol
	b.DarkInstVol += darkInstVol
	b.DarkBlockVol += darkBlockVol
	b.DarkBlockCount += darkBlockCount
}

func (a *Aggregator) Snapshot() []Bucket {
	min, max := int64(math.MaxInt64), int64(0)
	for k := range a.buckets {
		if k < min {
			min = k
		}
		if k > max {
			max = k
		}
	}
	if min > max {
		return nil
	}
	out := make([]Bucket, 0, (max-min)/a.bucketMs+1)
	for t := min; t <= max; t += a.bucketMs {
		if b, ok := a.buckets[t]; ok {
			out = append(out, *b)
		} else {
			out = append(out, Bucket{
				Epoch:    t,
				BucketMs: a.bucketMs,
			})
		}
	}
	return out
}
