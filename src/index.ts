type MakeNeverNonExistsKeys<T, Entity> = {
    [P in keyof T]: P extends keyof Entity
        ? (undefined extends Entity[P]
              ? undefined extends T[P]
                  ? MakeNeverNonExistsKeys<T[P], NonNullable<Entity[P]>>
                  : 'should be undefined union'
              : MakeNeverNonExistsKeys<T[P], NonNullable<Entity[P]>>)
        : (P extends '__args' ? {} : "Property doesn't exist")
};

export type GraphQLJSONConstraint<T, Entity> = MakeNeverNonExistsKeys<T, Entity>;

export function maybe<T>(val: T): T | undefined {
    return val;
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
