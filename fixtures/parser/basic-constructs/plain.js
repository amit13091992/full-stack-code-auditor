function greet(name) {
  return "Hello, " + name;
}

const shout = (name) => greet(name).toUpperCase();

module.exports = { greet, shout };
