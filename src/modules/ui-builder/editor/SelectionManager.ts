export class SelectionManager {
  private selectedIds: Set<string> = new Set();

  select(id: string, multiple = false): void {
    if (!multiple) {
      this.selectedIds.clear();
    }
    this.selectedIds.add(id);
  }

  deselect(id: string): void {
    this.selectedIds.delete(id);
  }

  clear(): void {
    this.selectedIds.clear();
  }

  getSelectedIds(): string[] {
    return Array.from(this.selectedIds);
  }

  isSelected(id: string): boolean {
    return this.selectedIds.has(id);
  }
}
