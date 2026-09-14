class Sized:
    def area(self):
        pass


class Shape:
    def __init__(self, name):
        self.name = name

    def describe(self):
        return self.name


@dataclass
class Circle(Shape, Sized):
    def __init__(self, name, radius):
        super().__init__(name)
        self.radius = radius

    def area(self):
        return 3.14159 * self.radius * self.radius


class _InternalHelper:
    def help(self):
        return "help"
