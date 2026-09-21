export class Widget {
  render(): string {
    return this.label();
  }

  label(): string {
    return "widget";
  }
}
