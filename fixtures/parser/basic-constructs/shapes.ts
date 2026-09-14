function readonly(target: unknown, key: string): void {
  void target;
  void key;
}

export interface Point {
  x: number;
  y: number;
}

export type Coordinates = [number, number];

export interface Sized {
  area(): number;
}

export enum Direction {
  Up,
  Down,
  Left,
  Right,
}

export abstract class Shape {
  @readonly
  readonly id: string;

  protected color: string = "black";

  constructor(id: string) {
    this.id = id;
  }

  abstract area(): number;

  describe(): string {
    return `${this.id} is ${this.color}`;
  }
}

export class Circle extends Shape implements Point, Sized {
  x = 0;
  y = 0;

  static defaultColor: string = "black";

  constructor(
    id: string,
    private radius: number,
  ) {
    super(id);
  }

  area(): number {
    return Math.PI * this.radius * this.radius;
  }

  get diameter(): number {
    return this.radius * 2;
  }

  set diameter(value: number) {
    this.radius = value / 2;
  }
}

class InternalHelper {
  help(): string {
    return "help";
  }
}
