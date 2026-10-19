export type EffectiveVisualQuality = 'eco' | 'balanced' | 'high';
export type VisualQuality = EffectiveVisualQuality | 'auto';

const levels: EffectiveVisualQuality[] = ['eco', 'balanced', 'high'];
const fps = [30, 45, 60];

export class AdaptiveVisualQuality {
  private setting: VisualQuality = 'balanced';
  private level = 0;
  private cost = 0;
  private cadence = 0;
  private samples = 0;
  private slow = 0;
  private fast = 0;
  private settling = 0;

  quality(setting: VisualQuality): EffectiveVisualQuality {
    if (setting !== this.setting) {
      this.setting = setting;
      this.reset();
    }
    return setting === 'auto' ? levels[this.level] : setting;
  }

  reset(): void { this.level = 0; this.pause(); }

  pause(): void {
    this.cost = this.cadence = this.samples = this.slow = this.fast = this.settling = 0;
  }

  sample(costMs: number, cadenceMs: number, elapsedMs: number): boolean {
    if (this.setting !== 'auto' || !Number.isFinite(costMs) || costMs < 0 || !Number.isFinite(cadenceMs) || cadenceMs <= 0 ||
      !Number.isFinite(elapsedMs) || elapsedMs <= 0) return false;
    elapsedMs = Math.min(elapsedMs, 250);
    const weight = this.samples++ ? .15 : 1;
    this.cost += (costMs - this.cost) * weight;
    this.cadence += (cadenceMs - this.cadence) * weight;
    this.settling += elapsedMs;
    if (this.settling < 1500) return false;
    const budget = 1000 / fps[this.level];
    const overloaded = this.cost > budget * .7 || this.cadence > budget * 1.35;
    this.slow = overloaded ? this.slow + elapsedMs : Math.max(0, this.slow - elapsedMs * 2);
    const next = this.level + 1;
    // Headroom estimates include the next pixel budget; RAF cadence also catches compositor pressure.
    const predictedCost = this.cost * (this.level === 0 ? 2.25 : 1.8) + .8;
    const headroom = next < levels.length && predictedCost < 1000 / fps[next] * .45 && this.cadence < 1000 / fps[next] * 1.1;
    this.fast = headroom && !overloaded ? this.fast + elapsedMs : 0;
    if (this.level > 0 && this.slow >= 1500) {
      this.level--; this.pause(); return true;
    }
    if (next < levels.length && this.fast >= (this.level === 0 ? 12000 : 20000)) {
      this.level++; this.pause(); return true;
    }
    return false;
  }
}
