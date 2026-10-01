// __tc_toFixed — emulates JS Number.prototype.toFixed exactly.
//
// JS spec: n/10^d closest to the double's EXACT value; ties -> larger |n|
// (away from zero). glibc printf %.Nf rounds the exact value with
// HALF-EVEN ties. They differ only at exact decimal ties (1.125, 2.5, 0.5 —
// values exactly representable in binary). Near-ties (2.675 -> binary
// 2.6749999..., 1.305 -> 1.3049999...) already agree.
//
// Correct implementation: printf the exact decimal expansion at high
// precision, then round that DECIMAL STRING half-away-from-zero at digit d
// with carry propagation. A double's expansion terminates within ~767
// places; 45 covers every round-relevant prefix.
export const TOFIXED_HELPERS = [
  `inline std::string __tc_toFixed(double val, int digits) {`,
  `    if (digits < 0) { digits = 0; }`,
  `    if (digits > 20) { digits = 20; }`,
  `    bool neg = val < 0;`,
  `    double a = neg ? -val : val;`,
  `    char big[64];`,
  `    snprintf(big, sizeof(big), "%.45f", a);`,
  `    const char* dot = strchr(big, '.');`,
  `    const char* frac = dot ? dot + 1 : "";`,
  `    bool carry = false;`,
  `    if (static_cast<int>(strlen(frac)) > digits && frac[digits] >= '5') { carry = true; }`,
  `    std::string intPart(dot ? std::string(big, dot - big) : std::string(big));`,
  `    std::string fracPart(dot ? std::string(frac) : std::string());`,
  `    if (carry) {`,
  `        int pos = digits - 1;`,
  `        bool intoInt = false;`,
  `        while (true) {`,
  `            if (pos >= 0) {`,
  `                if (fracPart[static_cast<size_t>(pos)] == '9') { fracPart[static_cast<size_t>(pos)] = '0'; pos--; continue; }`,
  `                fracPart[static_cast<size_t>(pos)]++; break;`,
  `            }`,
  `            intoInt = true; break;`,
  `        }`,
  `        if (intoInt) {`,
  `            int ip = static_cast<int>(intPart.size()) - 1;`,
  `            while (ip >= 0) {`,
  `                if (intPart[static_cast<size_t>(ip)] == '9') { intPart[static_cast<size_t>(ip)] = '0'; ip--; continue; }`,
  `                intPart[static_cast<size_t>(ip)]++; break;`,
  `            }`,
  `            if (ip < 0) { intPart = "1" + intPart; }`,
  `        }`,
  `    }`,
  `    std::string out = (neg ? "-" : "") + intPart;`,
  `    if (digits > 0) { out += "."; out += fracPart.substr(0, static_cast<size_t>(digits)); }`,
  `    return out;`,
  `}`,
];
