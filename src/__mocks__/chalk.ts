type ChalkFn = (value: unknown) => string;

const pass: ChalkFn = (value) => String(value);

const chalkMock = {
  blue: pass,
  green: pass,
  red: pass,
  yellow: pass,
  gray: pass,
  cyan: pass,
  magenta: pass,
  bold: pass
};

export = chalkMock;
