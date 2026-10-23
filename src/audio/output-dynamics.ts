import { outputDynamicsProfiles, type OutputDynamicsProfile } from '../output-dynamics';
import { smooth } from './graph';

export class OutputDynamics {
  readonly node: DynamicsCompressorNode;
  private profile: OutputDynamicsProfile;
  private disposed = false;

  constructor(private context: BaseAudioContext, profile: OutputDynamicsProfile = 'balanced') {
    this.profile = profile;
    this.node = context.createDynamicsCompressor();
    this.node.threshold.value = outputDynamicsProfiles.find(item => item.id === profile)!.threshold;
    this.node.knee.value = 6;
    this.node.ratio.value = 12;
    this.node.attack.value = .003;
    this.node.release.value = .25;
  }

  update(profile: OutputDynamicsProfile = 'balanced'): void {
    if (this.disposed || profile === this.profile) return;
    this.profile = profile;
    // A positive origin also preserves pre-start automation in Firefox's native timeline.
    smooth(this.node.threshold, outputDynamicsProfiles.find(item => item.id === profile)!.threshold,
      Math.max(this.context.currentTime, 1 / this.context.sampleRate));
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.node.disconnect();
  }
}
