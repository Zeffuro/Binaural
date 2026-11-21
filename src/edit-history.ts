export class EditHistory<T, Effect> {
  private past: string[] = [];
  private future: string[] = [];
  get canUndo(): boolean { return this.past.length > 0; }
  get canRedo(): boolean { return this.future.length > 0; }

  record(value: T): void { this.push(JSON.stringify({ value })); }

  recordEffect(effect: Effect): boolean { return this.push(JSON.stringify({ effect })); }

  private push(entry: string): boolean {
    if (entry.length > 4 * 1024 * 1024 || this.past.at(-1) === entry) return false;
    this.past.push(entry); this.future = [];
    while (this.past.length > 30 || this.past.reduce((sum, item) => sum + item.length, 0) > 12 * 1024 * 1024) this.past.shift();
    return true;
  }

  needsEffect(current: T, redo: boolean): boolean {
    const stack = redo ? this.future : this.past;
    const index = this.target(stack, JSON.stringify({ value: current }));
    return index >= 0 && (JSON.parse(stack[index]) as { effect?: Effect }).effect !== undefined;
  }

  skipEffect(current: T, redo: boolean, effect: Effect): void {
    const stack = redo ? this.future : this.past;
    const index = this.target(stack, JSON.stringify({ value: current }));
    if (index >= 0 && stack[index] === JSON.stringify({ effect })) stack.splice(index, 1);
  }

  move(current: T, redo: boolean, apply: (effect: Effect) => void): { value?: T } | undefined {
    const from = redo ? this.future : this.past;
    const to = redo ? this.past : this.future;
    const present = JSON.stringify({ value: current });
    const index = this.target(from, present);
    if (index < 0) { from.length = 0; return; }
    const entry = from[index], { value, effect } = JSON.parse(entry) as { value?: T; effect?: Effect };
    if (effect !== undefined) apply(effect);
    from.length = index;
    to.push(effect === undefined ? present : entry);
    return { value };
  }

  private target(stack: string[], present: string): number {
    let index = stack.length - 1;
    while (index >= 0 && stack[index] === present) index--;
    return index;
  }
}
