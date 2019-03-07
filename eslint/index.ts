import {Rule} from 'eslint';
import * as ESTree from 'estree';
import * as ts from 'typescript';
import {findUnusedProps} from '../common/findUnusedProps';

function loc(sourceFile: ts.SourceFile, pos: number) {
    const l = ts.getLineAndCharacterOfPosition(sourceFile, pos);
    return {
        line: l.line,
        column: l.character,
    };
}
const rule: Rule.RuleModule = {
    create(context) {
        return {
            Program(node) {
                const program: ts.Program = context.parserServices.program;
                const esTreeNodeToTSNodeMap: WeakMap<ESTree.Node, ts.Node> =
                    context.parserServices.esTreeNodeToTSNodeMap;
                const tsNodeToESTreeNodeMap: WeakMap<ts.Node, ESTree.Node> =
                    context.parserServices.esTreeNodeToTSNodeMap;
                const sourceFile = esTreeNodeToTSNodeMap.get(node) as ts.SourceFile;
                const {unusedProps, excessProps} = findUnusedProps(program, [sourceFile]);
                unusedProps.forEach(ident => {
                    const sourceFile = ident.getSourceFile();
                    context.report({
                        message: `Unused prop "${ident.getText()}"`,
                        loc: {
                            start: loc(sourceFile, ident.getStart()),
                            end: loc(sourceFile, ident.getEnd()),
                        },
                    });
                });
                excessProps.forEach(ident => {
                    const sourceFile = ident.getSourceFile();
                    context.report({
                        message: `Property "${ident.getText()}" doesn't exist`,
                        loc: {
                            start: loc(sourceFile, ident.getStart()),
                            end: loc(sourceFile, ident.getEnd()),
                        },
                    });
                });
            },
        };
    },
};
export = {
    rules: {
        'unused-props': rule,
    },
};
