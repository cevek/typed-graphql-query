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

// type Instance<T> = T extends new (...args: any[]) => infer R ? R : never;
// declare function args<Args, T>(args: Args, val: T): T & {__args: Args};
// declare function Union<A, B, C = never>(a: new () => A, b: new () => B, c?: new () => C): A | B | C;
// declare function arrArgs<Args, T>(args: Args, val: T[]): (T & {__args: Args})[];

interface Offer {
    name: string;
}

interface Coord {
    __typename: 'Coord';
    lat: number;
    lon: number;
}
interface Image {
    __typename: 'Image';
    width: number;
    height: number;
}

interface Product {
    name: '';
    offers: (Offer & {limit: 1})[];
    lastOffer?: Offer;
    messages: (Coord | Image)[];
    lastMessage: Coord | Image;
}

type UnionToIntersection<U> = (U extends any ? (k: U) => void : never) extends ((k: infer I) => void) ? I : never;
type IsUnion<T> = [T] extends [UnionToIntersection<T>] ? false : true;

// type AB = {on: {A: {a: number}; B: {b: number}}};
type AB_ = {__typename: 'A'; a: number} | {__typename: 'B'; b: number};

type TypenamesToIntersection<T> = T extends {__typename: string} ? {[P in T['__typename']]: Result2<T>} : never;
type TransformUnionToOn<T> = IsUnion<T> extends true ? {on: UnionToIntersection<TypenamesToIntersection<T>>} : Result2<T>;


type Result2<T> = {[P in keyof T]: TransformUnionToOn<T[P]>};

type J = TransformUnionToOn<AB_>;
var x!: J;
// x.on
type JH = TypenamesToIntersection<{__typename: 'A'; a: number} | {__typename: 'B'; b: number}>;

type AddTypename<T> = {[P in keyof T]: T[P] & {__typename: P}}[keyof T];
type TransformOnToUnion<T> = T extends {on: infer On} ? AddTypename<On> : T;
type Maybe<T> = T extends undefined ? undefined : never;
type Result<T, Entity> = {
    [P in keyof T]: P extends keyof Entity
        ? TransformOnToUnion<Result<T[P], NonNullable<Entity[P]>>> | Maybe<Entity[P]>
        : never
};

type X = Result2<Product>;
declare function query<T>(p: T | Result2<Product>): Result<T, Result2<Product>>;

query({
    lastOffer: {name: ''},
}).lastOffer!.name;

const lastMessage = query({
    name: '',
    lastOffer: {name: ''},
    offers: [{__args: {limit: 1}}],
    lastMessage: {on: {Coord: {lat: 1, lon: 1}, Image: {height: 1}}},
}).lastMessage;

if (lastMessage.__typename === 'Coord') {
    lastMessage.lat = 1;
} else {
    lastMessage.height = 1;
}

query({
    messages: [
        {
            on: {
                Coord: {
                    lat: 1,
                    lon: 0,
                },
                Image: {
                    height: 0,
                    width: 0,
                },
            },
        },
    ],
}).messages.map(msg => {
    if (msg.__typename === 'Coord') {
        msg.lat;
    } else {
        msg.height
    }
});

query({
    offers: [
        {
            name: 1,
        },
    ],
}).offers.map(offer => {
    offer.name;
});
