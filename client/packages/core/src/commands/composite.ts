import type { SkeletonData } from '../model/types.js';
import type { Command } from './history.js';

/**
 * Groups several commands into a single undo step. If a child command throws
 * during execute, the already-executed children are rolled back and the error
 * is rethrown, leaving the document unchanged.
 */
export class Composite implements Command {
  constructor(
    readonly label: string,
    private readonly commands: Command[],
  ) {}

  execute(data: SkeletonData): void {
    const done: Command[] = [];
    try {
      for (const command of this.commands) {
        command.execute(data);
        done.push(command);
      }
    } catch (err) {
      for (const command of done.reverse()) command.undo(data);
      throw err;
    }
  }

  undo(data: SkeletonData): void {
    for (let i = this.commands.length - 1; i >= 0; i--) {
      this.commands[i]?.undo(data);
    }
  }
}
