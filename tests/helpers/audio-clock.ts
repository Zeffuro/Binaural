export async function waitForAudioTime(context: BaseAudioContext, target: number, timeoutMs = 6000): Promise<void> {
  const deadline = performance.now() + timeoutMs;
  while (context.currentTime < target) {
    if (context.state === 'closed' || performance.now() >= deadline) {
      throw new Error(`Audio clock did not reach ${target.toFixed(3)}s; state=${context.state}, time=${context.currentTime.toFixed(3)}s.`);
    }
    await new Promise(resolve => setTimeout(resolve, 20));
  }
}
