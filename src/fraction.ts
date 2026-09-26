/**
 * 基于 BigInt 的精确分数，用于节奏时值的精确计算，避免浮点误差。
 * 不变式：den > 0，num/den 已约分为最简。
 */
function gcd(a: bigint, b: bigint): bigint {
  a = a < 0n ? -a : a;
  b = b < 0n ? -b : b;
  while (b !== 0n) {
    const t = a % b;
    a = b;
    b = t;
  }
  return a === 0n ? 1n : a;
}

export class Frac {
  private constructor(
    readonly num: bigint,
    readonly den: bigint,
  ) {}

  static of(num: bigint | number, den: bigint | number = 1): Frac {
    let n = BigInt(num);
    let d = BigInt(den);
    if (d === 0n) throw new Error('分数的分母不能为 0');
    if (d < 0n) {
      n = -n;
      d = -d;
    }
    const g = gcd(n, d);
    return new Frac(n / g, d / g);
  }

  static zero(): Frac {
    return Frac.of(0);
  }

  add(o: Frac): Frac {
    return Frac.of(this.num * o.den + o.num * this.den, this.den * o.den);
  }

  sub(o: Frac): Frac {
    return Frac.of(this.num * o.den - o.num * this.den, this.den * o.den);
  }

  mul(o: Frac): Frac {
    return Frac.of(this.num * o.num, this.den * o.den);
  }

  /** this 与 o 比较：-1 / 0 / 1 */
  cmp(o: Frac): number {
    const l = this.num * o.den;
    const r = o.num * this.den;
    return l < r ? -1 : l > r ? 1 : 0;
  }

  sign(): number {
    return this.num < 0n ? -1 : this.num > 0n ? 1 : 0;
  }

  abs(): Frac {
    return this.num < 0n ? Frac.of(-this.num, this.den) : this;
  }

  /** 最简分数形式，如 3/8；整数则不带分母 */
  toString(): string {
    return this.den === 1n ? `${this.num}` : `${this.num}/${this.den}`;
  }

  /** 带分数形式，如 1+1/4，便于阅读 */
  toMixed(): string {
    if (this.den === 1n) return `${this.num}`;
    const neg = this.num < 0n;
    const n = neg ? -this.num : this.num;
    const whole = n / this.den;
    const rem = n % this.den;
    const body = whole === 0n ? `${rem}/${this.den}` : `${whole}+${rem}/${this.den}`;
    return neg ? `-${body}` : body;
  }
}
