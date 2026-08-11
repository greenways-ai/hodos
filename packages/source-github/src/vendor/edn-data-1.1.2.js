/*
 * Browser-native ESM port of edn-data 1.1.2.
 * Upstream: https://github.com/jorinvo/edn-data
 * Commit: 1e5824f63803eb58f35e98839352000053d47115
 *
 * Copyright (c) 2020 Jorin Vogel
 * Licensed under the MIT License. See edn-data-LICENSE.txt beside this file.
 */

const ParseMode = Object.freeze({
  idle: 0,
  string: 1,
  escape: 2,
  comment: 3,
});

const StackItem = Object.freeze({
  vector: 0,
  list: 1,
  map: 2,
  set: 3,
  tag: 4,
});

const stringEscapeMap = Object.freeze({
  t: "\t",
  r: "\r",
  n: "\n",
  "\\": "\\",
  '"': '"',
});
const spaceChars = new Set([",", " ", "\t", "\n", "\r"]);
const intRegex = /^[-+]?(0|[1-9][0-9]*)$/;
const bigintRegex = /^[-+]?(0|[1-9][0-9]*)N$/;
const floatRegex = /^[-+]?(0|[1-9][0-9]*)(\.[0-9]+)?([eE][+-]?(0|[1-9][0-9]*))?M?$/;

const defaultTagHandlers = Object.freeze({
  inst(value) {
    if (typeof value !== "string") throw new Error("#inst value must be a string");
    return new Date(value);
  },
});

export class EDNListParser {
  constructor({
    mapAs = "doubleArray",
    setAs = "object",
    keywordAs = "object",
    charAs = "object",
    listAs = "object",
    tagHandlers = {},
    objectKeysAs,
  } = {}) {
    this.stack = [];
    this.mode = ParseMode.idle;
    this.state = "";
    this.result = undefined;
    this.started = false;
    this.done = false;
    this.mapAs = mapAs;
    this.setAs = setAs;
    this.keywordAs = keywordAs;
    this.charAs = charAs;
    this.listAs = listAs;
    this.objectKeysAs = objectKeysAs;
    this.tagHandlers = {...defaultTagHandlers, ...tagHandlers};
  }

  updateStack() {
    if (this.stack.length === 0 || this.result === undefined) return;
    const [stackItem, previousState] = this.stack[this.stack.length - 1];
    if (stackItem === StackItem.vector
        || stackItem === StackItem.list
        || stackItem === StackItem.set) {
      previousState.push(this.result);
    } else if (stackItem === StackItem.map) {
      if (previousState[1].length > 0) {
        previousState[0].push([previousState[1].pop(), this.result]);
      } else {
        previousState[1].push(this.result);
      }
    } else if (stackItem === StackItem.tag) {
      this.stack.pop();
      if (previousState === "_") {
        this.result = undefined;
      } else {
        const tagHandler = this.tagHandlers[previousState];
        this.result = tagHandler
          ? tagHandler(this.result)
          : {tag: previousState, val: this.result};
      }
      this.updateStack();
      return;
    }
    this.result = undefined;
  }

  match() {
    if (this.state === "nil") {
      this.result = null;
    } else if (this.state === "true") {
      this.result = true;
    } else if (this.state === "false") {
      this.result = false;
    } else if (this.state[0] === ":") {
      this.result = this.keywordAs === "string"
        ? this.state.slice(1)
        : {key: this.state.slice(1)};
    } else if (this.state[0] === "#") {
      this.stack.push([StackItem.tag, this.state.slice(1)]);
      this.result = undefined;
    } else if (intRegex.test(this.state)) {
      this.result = Number.parseInt(this.state, 10);
    } else if (floatRegex.test(this.state)) {
      this.result = Number.parseFloat(this.state);
    } else if (bigintRegex.test(this.state)) {
      this.result = BigInt(this.state.slice(0, -1));
    } else if (this.state[0] === "\\") {
      let character;
      if (this.state === "\\space") character = " ";
      else if (this.state === "\\newline") character = "\n";
      else if (this.state === "\\return") character = "\r";
      else if (this.state === "\\tab") character = "\t";
      else if (this.state === "\\\\") character = "\\";
      else character = this.state.slice(1);
      this.result = this.charAs === "string"
        ? character
        : {char: character};
    } else if (this.state !== "") {
      this.result = {sym: this.state};
    }
    this.state = "";
  }

  next(source) {
    const values = [];
    for (let index = 0; index < source.length; index += 1) {
      if (this.stack.length === 0 && this.result !== undefined) {
        values.push(this.result);
        this.result = undefined;
      }

      const character = source[index];
      if (this.mode === ParseMode.idle) {
        if (character === '"') {
          this.match();
          this.updateStack();
          this.mode = ParseMode.string;
          this.state = "";
          continue;
        }
        if (character === ";") {
          this.mode = ParseMode.comment;
          continue;
        }
        if (spaceChars.has(character)) {
          this.match();
          this.updateStack();
          continue;
        }
        if (character === "}") {
          this.match();
          this.updateStack();
          if (this.stack.length !== 0) {
            const [stackItem, previousState] = this.stack.pop();
            if (stackItem === StackItem.map) {
              if (this.mapAs === "object") {
                this.result = previousState[0].reduce((memo, [inputKey, inputValue]) => {
                  let key = inputKey;
                  let value = inputValue;
                  if (typeof inputKey === "object" && this.objectKeysAs) {
                    key = JSON.stringify(inputKey);
                    if (this.objectKeysAs === "object") {
                      value = {key: inputKey, value};
                    }
                  }
                  return {...memo, [key]: value};
                }, {});
              } else if (this.mapAs === "map") {
                this.result = new Map(previousState[0]);
              } else {
                this.result = {map: previousState[0]};
              }
            } else if (this.setAs === "array") {
              this.result = previousState;
            } else if (this.setAs === "set") {
              this.result = new Set(previousState);
            } else {
              this.result = {set: previousState};
            }
          }
          this.updateStack();
          continue;
        }
        if (character === "]") {
          this.match();
          this.updateStack();
          const [, previousState] = this.stack.pop();
          this.result = previousState;
          this.updateStack();
          continue;
        }
        if (character === ")") {
          this.match();
          this.updateStack();
          if (this.stack.length === 0) {
            if (this.result !== undefined) values.push(this.result);
            this.done = true;
            return values;
          }
          const [, previousState] = this.stack.pop();
          this.result = this.listAs === "array"
            ? previousState
            : {list: previousState};
          this.updateStack();
          continue;
        }
        if (character === "[") {
          this.match();
          this.updateStack();
          this.stack.push([StackItem.vector, []]);
          continue;
        }
        if (character === "(") {
          if (!this.started) {
            this.started = true;
            continue;
          }
          this.match();
          this.updateStack();
          this.stack.push([StackItem.list, []]);
          continue;
        }

        const statePlusCharacter = this.state + character;
        if (statePlusCharacter === "#_") {
          this.stack.push([StackItem.tag, character]);
          this.result = undefined;
          this.state = "";
          continue;
        }
        if (statePlusCharacter.endsWith("#{")) {
          this.state = this.state.slice(0, -1);
          this.match();
          this.updateStack();
          this.stack.push([StackItem.set, []]);
          this.state = "";
          continue;
        }
        if (character === "{") {
          this.match();
          this.updateStack();
          this.stack.push([StackItem.map, [[], []]]);
          this.state = "";
          continue;
        }
        this.state += character;
        continue;
      }

      if (this.mode === ParseMode.string) {
        if (character === "\\") {
          this.stack.push([this.mode, this.state]);
          this.mode = ParseMode.escape;
          this.state = "";
          continue;
        }
        if (character === '"') {
          this.mode = ParseMode.idle;
          this.result = this.state;
          this.updateStack();
          this.state = "";
          continue;
        }
        this.state += character;
        continue;
      }

      if (this.mode === ParseMode.escape) {
        const escapedCharacter = stringEscapeMap[character];
        const [stackItem, previousState] = this.stack.pop();
        this.mode = stackItem;
        this.state = previousState + escapedCharacter;
        continue;
      }

      if (this.mode === ParseMode.comment && character === "\n") {
        this.mode = ParseMode.idle;
      }
    }
    return values;
  }

  isDone() {
    return this.done;
  }
}

export function parseEDNString(source, parseOptions) {
  const parser = new EDNListParser(parseOptions);
  const [result] = parser.next(`(${source})`);
  return result === undefined ? null : result;
}
