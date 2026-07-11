import type { SkeletonData } from '../model/types.js';

/**
 * Every document mutation goes through a Command so it is undoable and can be
 * driven identically by the editor UI and the MCP server. Commands validate
 * their inputs and throw BEFORE mutating anything.
 */
export interface Command {
  readonly label: string;
  execute(data: SkeletonData): void;
  undo(data: SkeletonData): void;
}

export class History {
  private undos: Command[] = [];
  private redos: Command[] = [];

  constructor(private readonly limit = 100) {}

  execute(data: SkeletonData, command: Command): void {
    command.execute(data);
    this.undos.push(command);
    if (this.undos.length > this.limit) this.undos.shift();
    this.redos = [];
  }

  undo(data: SkeletonData): boolean {
    const command = this.undos.pop();
    if (!command) return false;
    command.undo(data);
    this.redos.push(command);
    return true;
  }

  redo(data: SkeletonData): boolean {
    const command = this.redos.pop();
    if (!command) return false;
    command.execute(data);
    this.undos.push(command);
    return true;
  }

  get canUndo(): boolean {
    return this.undos.length > 0;
  }

  get canRedo(): boolean {
    return this.redos.length > 0;
  }

  clear(): void {
    this.undos = [];
    this.redos = [];
  }
}
