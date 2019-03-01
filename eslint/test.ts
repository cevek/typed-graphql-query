import rule from '.';
import {RuleTester} from 'eslint';

const ruleTester = new RuleTester({
    parserOptions: {
        project: '../tsconfig.json',
        ecmaFeatures: {
            jsx: true,
        },
    },
    parser: '@typescript-eslint/parser',
});

ruleTester.run('unused-graphql-query-props', rule.rules['unused-props'], {
    valid: [],

    invalid: [
        // {
        //     code: 'foo();',
        //     errors: [{message: 'Unexpected invalid variable.'}],
        // },
    ],
});
