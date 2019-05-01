type Primitive = boolean | number | string | Date;
export type TransformMethods<T> = {
    [K in keyof T]: T[K] extends (args: infer Args) => infer Entity
        ? [Entity] extends [Primitive]
            ? (args: Args) => Entity
            : <Q extends DeepPartial<TransformEntity<NonNullable<Entity>>>>(
                  args: Args,
                  query: Q | TransformEntity<NonNullable<Entity>>,
              ) => Result<TransformEntity<Entity>>
        : never
};
type DeepPartial<T> = {[P in keyof T]?: DeepPartial<T[P]>};

export function graphqlFactory<Query extends object, Mutation extends object>(
    fetchGraphqlQuery: (query: string, method: string, originQuery: object, type: 'query' | 'mutation') => {},
) {
    const res = {query: {} as TransformMethods<Query>, mutation: {} as TransformMethods<Mutation>};
    for (const type of ['query', 'mutation'] as (keyof typeof res)[]) {
        res[type] = new Proxy(
            {},
            {
                get(target: any, prop) {
                    const fn = target[prop];
                    if (fn) return fn;
                    target[prop] = (args: {}, query: {}) => {
                        const preparedQuery = {...query, __args: args};
                        const queryS = type + toGraphQLQuery({[prop]: preparedQuery});
                        return fetchGraphqlQuery(queryS, prop as string, preparedQuery, type) as unknown;
                    };
                    return target[prop];
                },
            },
        );
    }
    return res;
}

function error(str: string, json: object) {
    const error = new Error(str);
    (error as {json?: object}).json = json;
    return error;
}

export function toGraphQLQuery(query: any): string {
    function argToQuery(arg: unknown, wrapObjWithCurly: boolean): string {
        if (typeof arg === 'object' && arg !== null) {
            if (arg instanceof Array) {
                return `[${arg.map(a => argToQuery(a, true)).join(',')}]`;
            }
            if (arg instanceof Date) {
                return JSON.stringify(arg);
            }
            const objVals = [];
            for (const k in arg) {
                objVals.push(`${k}:${argToQuery(arg[k as never], true)}`);
            }
            if (objVals.length === 0) throw error(`Graphql argument cannot be empty object`, {query, arg});
            if (wrapObjWithCurly) return `{${objVals.join(',')}}`;
            return objVals.join(',');
        }
        return JSON.stringify(arg);
    }

    let s = '';
    if (typeof query === 'object' && query !== null) {
        if (query instanceof Array) return toGraphQLQuery(query[0]);
        if (query.__args) {
            s += `(${argToQuery(query.__args, false)})`;
        }
        let i = 0;
        let sub = '';
        for (const key in query) {
            const val = query[key];
            if (key === '__args') continue;
            if (key === '__on') {
                for (const typeName in val) {
                    sub += `...on ${typeName}${toGraphQLQuery(val[typeName])}`;
                }
                continue;
            }
            sub += `${i > 0 ? ',' : ''}${key}${toGraphQLQuery(val)}`;
            i++;
        }
        if (sub.length > 0) s += `{${sub}}`;
    }
    return s;
}

// type Instance<T> = T extends new (...args: any[]) => infer R ? R : never;
// declare function args<Args, T>(args: Args, val: T): T & {__args: Args};
// declare function Union<A, B, C = never>(a: new () => A, b: new () => B, c?: new () => C): A | B | C;
// declare function arrArgs<Args, T>(args: Args, val: T[]): (T & {__args: Args})[];

type UnionToIntersection<U> = (U extends any ? (k: U) => void : never) extends ((k: infer I) => void) ? I : never;
type IsUnion<T> = [T] extends [UnionToIntersection<T>] ? false : true;

// type AB = {on: {A: {a: number}; B: {b: number}}};
// type AB_ = {__typename: 'A'; a: number} | {__typename: 'B'; b: number};
// type J = TransformUnionToOn<AB_>;
// var x!: J;
// x.on
// type JH = TypenamesToIntersection<{__typename: 'A'; a: number} | {__typename: 'B'; b: number}>;
// type X = TransformEntity<Product>;

// type TypenamesToIntersection<T, Args> = T extends {__typename: string}
//     ? {[P in T['__typename']]: TransformEntity<T, Args>}
//     : never;
// type UnionToOn<T, Args = {}> = IsUnion<NonNullable<T>> extends true
//     ? {on: UnionToIntersection<TypenamesToIntersection<T, Args>>} & Args
//     : TransformEntity<T, Args>;

// // type G<T> = [T] extends [(args: infer Args) => infer R] ? TransformEntity<R> : UnionToOn<T>;
// type TransformEntity<T, Args> = {
//     [P in keyof T]: T[P] extends (args: infer _Args) => infer R // ? R extends Array<infer RR> // ? (UnionToOn<RR> & {__args: Args})[] :
//         ? UnionToOn<R, {__args: _Args}>
//         : UnionToOn<T[P], Args>

//     // T[P] extends (args: infer Args) => infer R
//     // ? (R extends Array<infer RR> ? (TransformEntity<RR> & {__args: Args})[] : TransformEntity<R>) // & {__args: Args}
//     // : UnionToOn<T[P]>
// };
type TypenamesToIntersection<T> = T extends {__typename: string} ? {[P in T['__typename']]: TransformEntity<T>} : never;
type UnionToOn<T> = IsUnion<NonNullable<T>> extends true
    ? {on: UnionToIntersection<TypenamesToIntersection<T>>}
    : TransformEntity<T>;

type TransformEntity<T> = {
    [P in keyof T]: T[P] extends (args: infer _Args) => infer R
        ? [R] extends [Array<infer RR>]
            ? (UnionToOn<RR> & {__args: _Args})[]
            : UnionToOn<R> & {__args: _Args}
        : UnionToOn<T[P]>
};

type AddTypename<T> = {[P in keyof T]: Result<T[P]> & {__typename: P}}[keyof T];
type OnToUnion<T> = T extends {on: infer On} ? AddTypename<On> : Result<T>;
type Result<T> = {[P in keyof T]: OnToUnion<T[P]>};

// type X = Result<{lastMessagesWithArg: {on: {Image: {height: number}}}[]} | TransformEntity<Product>>;
// var x!: X;
// x.lastMessagesWithArg.map(m => {

// });
// if (x.lastMessage.__typename === 'Image') {
//     x.lastMessage.height
// }
// var x: X = {
//     name: '',
//     lastMessageWithArg: {
//         __args: {size: 1},
//         on: {
//             Coord: {
//                 lat: 0,
//             },
//         },
//         // on: {
//         //     Coord: {
//         //         __typename: 'Coord',
//         //         lat: 0,
//         //         lon: 0,
//         //     },
//         //     Image: {
//         //         __typename: 'Image',
//         //         height: 0,
//         //         width: 0,
//         //     },
//         // },
//     },
// };

// var x: X = {
//     name: '',
//     lastMessagesWithArg: [
//         {
//             __args: {
//                 size: 0
//             },
//             on: {
//                 Coord: {
//                     lat: 1
//                 }
//             }
//         }
//     ],
// };

// // interface Offer {
// //     name: string;
// // }

// interface Coord {
//     __typename: 'Coord';
//     /**
//      * Hello
//      */
//     lat: number;
//     lon: number;
// }
// interface Image {
//     __typename: 'Image';
//     width: number;
//     height: number;
// }

// interface Product {
//     // name: '';
//     // offers(args: {limit: 1}): Offer[];
//     // coords(args: {limit: number}): Coord;
//     // lastOffer?: Offer;
//     // messages: (Coord | Image)[];
//     // lastMessage: Coord | Image;
//     // lastMessageWithArg(arg: {size: number}): Coord | Image;
//     lastMessagesWithArg(arg: {size: number}): (Coord | Image)[];
// }
// declare function query<T>(p: T | TransformEntity<Product>): Result<T | TransformEntity<Product>>;

// query({
//     lastOffer: {name: ''},
// }).lastOffer!.name;

// const lastMessage = query({
//     name: '',
//     lastOffer: {name: ''},
//     offers: [{__args: {limit: 1}}],
//     lastMessage: {on: {Coord: {lat: 1, lon: 1}, Image: {height: 1}}},
// }).lastMessage;

// if (lastMessage.__typename === 'Coord') {
//     lastMessage.lat = 1;
//     // lastMessage.
// } else {
//     lastMessage.height = 1;
//     // lastMessage.
// }

// query({
//     messages: [
//         {
//             on: {
//                 Coord: {
//                     lat: 1,
//                     lon: 0,
//                 },
//                 Image: {
//                     height: 0,
//                     width: 0,
//                 },
//             },
//         },
//     ],
// }).messages.map(msg => {
//     if (msg.__typename === 'Coord') {
//         msg.lat;
//     } else {
//         msg.height;
//     }
// });

// query({
//     offers: [
//         {
//             name: 1,
//         },
//     ],
// }).offers.map(offer => {
//     offer.name;
// });

// query({
//     coords: [
//         {
//             __args: {
//                 limit: 10,
//             },
//             lat: 0,
//         },
//     ],
// }).coords;

// const res = query({
//     coords: {
//         __args: {
//             limit: 1,
//         },
//         lat: 0,
//     },
//     lastOffer: {
//         name: '',
//     },
//     lastMessage: {
//         on: {
//             Coord: {
//                 lat: 0,
//             },
//         },
//     },
// });
// res.lastOffer!.name;
// if (res.lastMessage.__typename === 'Coord') {
//     res.lastMessage;
// }

// res.coords.lat
// type A = {a: number; b: number, c: {c1: number}};
// type Entity = {a: number; b: number; c: {c1: number; c2: number}};
// var f!: A | Entity;
// f
