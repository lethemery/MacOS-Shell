// SPDX-License-Identifier: GPL-2.0-or-later

const FUNCTIONS = {
    sqrt: Math.sqrt,
    abs: Math.abs,
    sin: x => Math.sin(x),
    cos: x => Math.cos(x),
    tan: x => Math.tan(x),
    ln: Math.log,
    log: Math.log10,
    exp: Math.exp,
    round: Math.round,
    floor: Math.floor,
    ceil: Math.ceil,
};

const CONSTANTS = {
    pi: Math.PI,
    'π': Math.PI,
    e: Math.E,
};

function tokenize(input) {
    const tokens = [];
    const re = /\s*(?:(\d+(?:[.,]\d+)?(?:e[+-]?\d+)?)|([a-zπ]+)|(\*\*|[-+*/%^()×÷]))/iy;
    let m;
    re.lastIndex = 0;
    while (re.lastIndex < input.length) {
        const start = re.lastIndex;
        m = re.exec(input);
        if (!m || m.index !== start) {
            if (/^\s*$/.test(input.slice(start)))
                break;
            return null;
        }
        if (m[1] !== undefined)
            tokens.push({type: 'num', value: parseFloat(m[1].replace(',', '.'))});
        else if (m[2] !== undefined)
            tokens.push({type: 'name', value: m[2].toLowerCase()});
        else
            tokens.push({type: 'op', value: {'**': '^', '×': '*', '÷': '/'}[m[3]] ?? m[3]});
    }
    return tokens;
}

export function evaluate(input) {
    const text = input.trim();
    if (!text)
        return null;
    const tokens = tokenize(text);
    if (!tokens || tokens.length === 0)
        return null;

    const hasOperator = tokens.some(t => t.type === 'op' && t.value !== '(' && t.value !== ')') ||
        tokens.some(t => t.type === 'name' && t.value in FUNCTIONS);
    if (!hasOperator)
        return null;

    let pos = 0;
    const peek = () => tokens[pos];
    const isOp = v => peek()?.type === 'op' && peek().value === v;
    const fail = () => {
        throw new Error('syntax');
    };

    const expr = () => {
        let value = term();
        while (isOp('+') || isOp('-')) {
            const op = tokens[pos++].value;
            const rhs = term();
            value = op === '+' ? value + rhs : value - rhs;
        }
        return value;
    };
    const term = () => {
        let value = factor();
        while (isOp('*') || isOp('/') || isOp('%')) {
            const op = tokens[pos++].value;
            const rhs = factor();
            if (op === '*')
                value *= rhs;
            else if (op === '/')
                value /= rhs;
            else
                value %= rhs;
        }
        return value;
    };
    const factor = () => {
        const base = unary();
        if (isOp('^')) {
            pos++;
            return base ** factor();
        }
        return base;
    };
    const unary = () => {
        if (isOp('-')) {
            pos++;
            return -unary();
        }
        if (isOp('+')) {
            pos++;
            return unary();
        }
        return call();
    };
    const call = () => {
        const t = peek();
        if (t?.type === 'name' && t.value in FUNCTIONS) {
            pos++;
            if (!isOp('('))
                fail();
            pos++;
            const arg = expr();
            if (!isOp(')'))
                fail();
            pos++;
            return FUNCTIONS[t.value](arg);
        }
        return primary();
    };
    const primary = () => {
        const t = peek();
        if (!t)
            fail();
        if (t.type === 'num') {
            pos++;
            return t.value;
        }
        if (t.type === 'name' && t.value in CONSTANTS) {
            pos++;
            return CONSTANTS[t.value];
        }
        if (isOp('(')) {
            pos++;
            const value = expr();
            if (!isOp(')'))
                fail();
            pos++;
            return value;
        }
        return fail();
    };

    try {
        const value = expr();
        if (pos !== tokens.length || !Number.isFinite(value))
            return null;
        return value;
    } catch {
        return null;
    }
}

export function formatNumber(value) {
    if (Number.isInteger(value) && Math.abs(value) < 1e15)
        return String(value);
    return String(Number(value.toPrecision(12)));
}
