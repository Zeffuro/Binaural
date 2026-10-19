export class EditHistory<T> {
  private past: string[] = [];
  private future: string[] = [];
  get canUndo(): boolean { return this.past.length > 0; }
  get canRedo(): boolean { return this.future.length > 0; }

  record(value: T): void {
    const entry = JSON.stringify(value);
    if (entry.length > 4 * 1024 * 1024 || this.past.at(-1) === entry) return;
    this.past.push(entry); this.future = [];
    while (this.past.length > 30 || this.past.reduce((sum, item) => sum + item.length, 0) > 12 * 1024 * 1024) this.past.shift();
  }
  undo(current: T): T | undefined {
    const present = JSON.stringify(current);
    let entry = this.past.pop(); while (entry === present) entry = this.past.pop();
    if (!entry) return;
    this.future.push(present); return JSON.parse(entry) as T;
  }
  redo(current: T): T | undefined {
    const present = JSON.stringify(current);
    let entry = this.future.pop(); while (entry === present) entry = this.future.pop();
    if (!entry) return;
    this.past.push(present); return JSON.parse(entry) as T;
  }
}
