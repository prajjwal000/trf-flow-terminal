package classifier

import "math"

type FlowClass int

const (
	Lit FlowClass = iota
	DarkRetail
	DarkInstitutionalSmall
	DarkInstitutionalMid
	DarkInstitutionalBlock
)

func (f FlowClass) String() string {
	switch f {
	case Lit:
		return "lit"
	case DarkRetail:
		return "dark_retail"
	case DarkInstitutionalSmall:
		return "dark_inst_small"
	case DarkInstitutionalMid:
		return "dark_inst_mid"
	case DarkInstitutionalBlock:
		return "dark_inst_block"
	default:
		return "unknown"
	}
}

type Trade struct {
	Price    float64
	Size     uint32
	Exchange string
}

func Classify(t Trade) FlowClass {
	if t.Exchange != "D" && t.Exchange != "E" {
		return Lit
	}

	fractionalCent := math.Mod(t.Price*100, 1.0)
	if fractionalCent > 0.001 && fractionalCent < 0.999 {
		return DarkRetail
	}

	notional := t.Price * float64(t.Size)
	switch {
	case notional >= 10_000_000:
		return DarkInstitutionalBlock
	case notional >= 1_000_000:
		return DarkInstitutionalMid
	default:
		return DarkInstitutionalSmall
	}
}
