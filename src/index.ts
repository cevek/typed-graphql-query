export function maybe<T>(val: T): T | undefined {
    return val;
}

export function union<Union, A, B>(union: Union, a: A | Union, b: B | Union): A | B;
export function union<Union, A, B, C>(union: Union, a: A | Union, b: B | Union, c: C | Union): A | B | C;
export function union<Union, A, B, C, D>(
    union: Union,
    a: A | Union,
    b: B | Union,
    c: C | Union,
    d: D | Union,
): A | B | C | D;
export function union<Union, A, B, C, D, E>(
    union: Union,
    a: A | Union,
    b: B | Union,
    c: C | Union,
    d: D | Union,
    e: E | Union,
): A | B | C | D | E;
export function union<Union, T extends {__typename: string}>(union: Union, ...types: T[]): T | Union {
    const obj = {} as {[typename: string]: {}};
    for (let i = 0; i < types.length; i++) {
        const type = types[i];
        if (type.__typename !== undefined) {
            obj[type.__typename] = type;
        }
    }
    return ({__on: obj} as unknown) as T | Union;
}

type IsUndefined<T> = undefined extends T ? undefined : never;
export type TransformMethods<T> = {
    [K in keyof T]: T[K] extends (args: infer Args) => infer Entity
        ? <Query>(args: Args, query: Query | Entity) => Query | IsUndefined<Entity>
        : never
};

export function graphqlFactory<Root extends object>(fetchGraphqlQuery: (query: string) => {}): TransformMethods<Root> {
    const obj = {} as Root;
    return new Proxy(obj, {
        get(target: any, prop) {
            const fn = target[prop];
            if (fn) return fn;
            target[prop] = (query: {}) => {
                const queryS = toGraphQLQuery({[prop]: query});
                return (fetchGraphqlQuery(queryS) as any)[prop];
            };
            return target[prop];
        },
    });
}

export function toGraphQLQuery(query: any): string {
    let s = '';
    if (typeof query === 'object' && query !== null) {
        if (query instanceof Array) return toGraphQLQuery(query[0]);
        if (query.__args) {
            s += '(';
            for (const arg in query.__args) {
                s += `${arg}:${JSON.stringify(query.__args[arg])}`;
            }
            s += ')' + toGraphQLQuery(query.body);
            return s;
        }
        s += `{`;
        let i = 0;
        for (const key in query) {
            const val = query[key];
            if (key === '__on') {
                for (const typeName in val) {
                    s += `...on ${typeName}${toGraphQLQuery(val[typeName])}`;
                }
                continue;
            }
            s += `${i > 0 ? ',' : ''}${key}${toGraphQLQuery(val)}`;
            i++;
        }
        s += `}`;
    }
    return s;
}
