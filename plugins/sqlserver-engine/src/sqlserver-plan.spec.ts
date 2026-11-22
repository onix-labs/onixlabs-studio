import { describe, expect, it } from 'vitest';
import { PlanNode, QueryPlan } from '../../protocol/database/protocol';
import {
  formatXml,
  parseXml,
  sqlServerPlans,
  statementLocator,
  XmlElement,
} from './sqlserver-plan';

/**
 * An estimated showplan as SQL Server 2022 sends it for one batch of two statements: a `DECLARE`,
 * which has no plan, and a join of two tables, a Hash Match over a clustered index scan and an index
 * seek. Trimmed of the elements the tree does not read, on one line as the server sends it.
 */
const ESTIMATED: string = [
  '<ShowPlanXML xmlns="http://schemas.microsoft.com/sqlserver/2004/07/showplan" Version="1.564" Build="16.0.4165.4">',
  '<BatchSequence><Batch><Statements>',
  '<StmtSimple StatementText="declare @n int = 3" StatementId="1" StatementType="ASSIGN" />',
  '<StmtSimple StatementText="select b.title, a.name from books b join authors a on a.id = b.author_id where b.year &gt; 1990" ',
  'StatementId="2" StatementType="SELECT" StatementSubTreeCost="0.0391" StatementEstRows="120" StatementOptmLevel="FULL">',
  '<StatementSetOptions ANSI_NULLS="true" />',
  '<QueryPlan CachedPlanSize="32" CompileTime="2">',
  '<RelOp NodeId="0" PhysicalOp="Hash Match" LogicalOp="Inner Join" EstimateRows="120" EstimateIO="0" EstimateCPU="0.017" EstimatedTotalSubtreeCost="0.0391" Parallel="0">',
  '<OutputList><ColumnReference Database="[shop]" Schema="[dbo]" Table="[books]" Column="title" /></OutputList>',
  '<Hash>',
  '<RelOp NodeId="1" PhysicalOp="Clustered Index Scan" LogicalOp="Clustered Index Scan" EstimateRows="40" EstimatedTotalSubtreeCost="0.0032">',
  '<IndexScan Ordered="0"><Object Database="[shop]" Schema="[dbo]" Table="[authors]" Index="[PK_authors]" IndexKind="Clustered" /></IndexScan>',
  '</RelOp>',
  '<RelOp NodeId="2" PhysicalOp="Index Seek" LogicalOp="Index Seek" EstimateRows="120.5" EstimatedTotalSubtreeCost="0.0188">',
  '<IndexScan Ordered="1"><Object Database="[shop]" Schema="[dbo]" Table="[books]" Index="[books_by_year]" /></IndexScan>',
  '</RelOp>',
  '</Hash>',
  '</RelOp>',
  '</QueryPlan>',
  '</StmtSimple>',
  '</Statements></Batch></BatchSequence>',
  '</ShowPlanXML>',
].join('');

/**
 * An actual plan as `SET STATISTICS XML ON` sends it: a parallel scan whose run-time counters come
 * per thread.
 */
const ACTUAL: string = [
  '<?xml version="1.0" encoding="utf-16"?>',
  '<ShowPlanXML xmlns="http://schemas.microsoft.com/sqlserver/2004/07/showplan"><BatchSequence><Batch><Statements>',
  '<StmtSimple StatementText="select * from books" StatementType="SELECT" StatementSubTreeCost="1.2" StatementEstRows="1000">',
  '<QueryPlan DegreeOfParallelism="2"><QueryTimeStats CpuTime="4" ElapsedTime="3" />',
  '<RelOp NodeId="0" PhysicalOp="Clustered Index Scan" LogicalOp="Clustered Index Scan" EstimateRows="1000" EstimatedTotalSubtreeCost="1.2">',
  '<RunTimeInformation>',
  '<RunTimeCountersPerThread Thread="1" ActualRows="600" ActualElapsedms="2" ActualExecutions="1" ActualLogicalReads="10" />',
  '<RunTimeCountersPerThread Thread="2" ActualRows="900" ActualElapsedms="3" ActualExecutions="1" ActualLogicalReads="12" />',
  '</RunTimeInformation>',
  '<IndexScan><Object Schema="[dbo]" Table="[books]" Index="[PK_books]" /></IndexScan>',
  '</RelOp></QueryPlan></StmtSimple></Statements></Batch></BatchSequence></ShowPlanXML>',
].join('');

/**
 * Reads the operators of a tree, each indented by its depth, for a compact assertion of its shape.
 * @param node The top step.
 * @param depth Its depth.
 * @returns Returns one line per step.
 */
function outline(node: PlanNode, depth: number = 0): readonly string[] {
  return [
    `${'  '.repeat(depth)}${node.operator}${node.detail === undefined ? '' : ` ${node.detail}`}`,
    ...node.children.flatMap((child: PlanNode): readonly string[] => outline(child, depth + 1)),
  ];
}

/**
 * Places every statement on line 1, for the specs that are not about lines.
 * @returns Returns 1.
 */
function firstLine(): number {
  return 1;
}

/**
 * A Nested Loops whose inner side, an index seek, runs once per outer row: SQL Server estimates its
 * rows per execution (1) and reports its actual rows over all of them (1,000).
 */
const NESTED: string = [
  '<ShowPlanXML><BatchSequence><Batch><Statements>',
  '<StmtSimple StatementText="select * from orders o join customers c on c.id = o.customer_id" StatementType="SELECT">',
  '<QueryPlan>',
  '<RelOp PhysicalOp="Nested Loops" LogicalOp="Inner Join" EstimateRows="1000" EstimatedTotalSubtreeCost="3.2">',
  '<RunTimeInformation><RunTimeCountersPerThread Thread="0" ActualRows="1000" ActualExecutions="1" /></RunTimeInformation>',
  '<NestedLoops>',
  '<RelOp PhysicalOp="Clustered Index Scan" LogicalOp="Clustered Index Scan" EstimateRows="1000" EstimatedTotalSubtreeCost="0.8">',
  '<RunTimeInformation><RunTimeCountersPerThread Thread="0" ActualRows="1000" ActualExecutions="1" /></RunTimeInformation>',
  '</RelOp>',
  '<RelOp PhysicalOp="Clustered Index Seek" LogicalOp="Clustered Index Seek" EstimateRows="1" EstimateRebinds="998" EstimateRewinds="1" EstimatedTotalSubtreeCost="2.1">',
  '<RunTimeInformation><RunTimeCountersPerThread Thread="0" ActualRows="1000" ActualExecutions="1000" /></RunTimeInformation>',
  '</RelOp>',
  '</NestedLoops>',
  '</RelOp></QueryPlan></StmtSimple></Statements></Batch></BatchSequence></ShowPlanXML>',
].join('');

/**
 * A batch's estimated showplan holding two statements, each with a plan.
 */
const TWO_STATEMENTS: string = [
  '<ShowPlanXML><BatchSequence><Batch><Statements>',
  '<StmtSimple StatementText="select 1" StatementType="SELECT"><QueryPlan><RelOp PhysicalOp="Constant Scan" LogicalOp="Constant Scan" EstimateRows="1" /></QueryPlan></StmtSimple>',
  '<StmtSimple StatementText="select name from authors" StatementType="SELECT"><QueryPlan><RelOp PhysicalOp="Table Scan" LogicalOp="Table Scan" EstimateRows="40" /></QueryPlan></StmtSimple>',
  '</Statements></Batch></BatchSequence></ShowPlanXML>',
].join('');

describe('sqlServerPlans', () => {
  it('builds_aPlanPerStatementWithAQueryPlan_underTheStatementAsSsmsDraws', () => {
    const plans: readonly QueryPlan[] = sqlServerPlans(ESTIMATED, firstLine);

    expect(plans).toHaveLength(1);
    expect(plans[0]?.statement).toBe(
      'select b.title, a.name from books b join authors a on a.id = b.author_id where b.year > 1990',
    );
    expect(plans[0]?.line).toBe(1);
    expect(outline(plans[0].root)).toEqual([
      'SELECT',
      '  Hash Match Inner Join',
      '    Clustered Index Scan [dbo].[authors].[PK_authors]',
      '    Index Seek [dbo].[books].[books_by_year]',
    ]);
  });

  it('reads_theEstimatedCostAndRows_ofTheStatementAndEachOperator', () => {
    const root: PlanNode = sqlServerPlans(ESTIMATED, firstLine)[0].root;
    const join: PlanNode = root.children[0];

    expect(root).toMatchObject({ cost: 0.0391, estimatedRows: 120 });
    expect(join).toMatchObject({ cost: 0.0391, estimatedRows: 120 });
    expect(join.children[1]).toMatchObject({ cost: 0.0188, estimatedRows: 120.5 });
    expect(join.actualRows).toBeUndefined();
    expect(join.time).toBeUndefined();
  });

  it('keeps_everyOtherAttributeAsAProperty_inTheEnginesOwnNames', () => {
    const root: PlanNode = sqlServerPlans(ESTIMATED, firstLine)[0].root;

    expect(root.properties).toEqual(
      expect.arrayContaining([
        { name: 'StatementOptmLevel', value: 'FULL' },
        { name: 'CachedPlanSize', value: '32' },
      ]),
    );
    expect(root.children[0]?.properties).toEqual(
      expect.arrayContaining([
        { name: 'EstimateCPU', value: '0.017' },
        { name: 'Parallel', value: '0' },
      ]),
    );
    expect(root.children[0]?.properties).not.toContainEqual(
      expect.objectContaining({ name: 'PhysicalOp' }),
    );
  });

  it('sums_anActualPlansRowsAcrossThreads_andTakesTheSlowestThreadsTime', () => {
    const root: PlanNode = sqlServerPlans(ACTUAL, firstLine)[0].root;
    const scan: PlanNode = root.children[0];

    expect(scan).toMatchObject({ estimatedRows: 1000, actualRows: 1500, time: 3 });
    expect(scan.properties).toEqual(
      expect.arrayContaining([
        { name: 'ActualExecutions', value: '2' },
        { name: 'ActualLogicalReads', value: '22' },
      ]),
    );
    expect(root.properties).toEqual(
      expect.arrayContaining([
        { name: 'DegreeOfParallelism', value: '2' },
        { name: 'ElapsedTime', value: '3' },
      ]),
    );
  });

  it('gives_eachStatementItsOwnElementIndented_asItsRawPlan_notTheWholeBatch', () => {
    const plans: readonly QueryPlan[] = sqlServerPlans(TWO_STATEMENTS, firstLine);

    expect(plans.map((plan: QueryPlan): string => plan.raw.split('\n')[0] ?? '')).toEqual([
      '<StmtSimple StatementText="select 1" StatementType="SELECT">',
      '<StmtSimple StatementText="select name from authors" StatementType="SELECT">',
    ]);
    expect(plans[0]?.raw).not.toContain('authors');
    expect(sqlServerPlans(ESTIMATED, firstLine)[0]?.raw).toContain('where b.year &gt; 1990"');
    expect(sqlServerPlans(ESTIMATED, firstLine)[0]?.raw).not.toContain('declare @n');
  });

  it('places_eachStatementOnItsOwnLine_withinTheBatch', () => {
    const batch: string = 'select 1\n\n-- the authors\nselect name\nfrom authors';
    const plans: readonly QueryPlan[] = sqlServerPlans(
      TWO_STATEMENTS.replace('select name from authors', 'select name\nfrom authors'),
      statementLocator(batch, 10),
    );

    expect(plans.map((plan: QueryPlan): number => plan.line)).toEqual([10, 13]);
  });

  it('places_aStatementTheServerRewrote_onTheBatchsFirstLine', () => {
    const locate: (statement: string) => number = statementLocator('select  1', 7);

    expect(locate('select 1')).toBe(7);
  });

  it('estimates_anInnerSidesRowsAcrossAllItsExecutions_soItIsNotFlaggedAsMisestimated', () => {
    const loops: PlanNode = sqlServerPlans(NESTED, firstLine)[0].root.children[0];
    const seek: PlanNode = loops.children[1];

    expect(seek).toMatchObject({ estimatedRows: 1000, actualRows: 1000 });
    expect(seek.properties).toContainEqual({ name: 'EstimateRows', value: '1' });
    expect(loops.children[0]).toMatchObject({ estimatedRows: 1000, actualRows: 1000 });
  });

  it('answers_noPlans_forTextThatIsNotADocument', () => {
    expect(sqlServerPlans('', firstLine)).toEqual([]);
    expect(sqlServerPlans('not xml', firstLine)).toEqual([]);
  });
});

describe('parseXml', () => {
  it('reads_elementsAndAttributes_decodingEntities_andSkippingTheProlog', () => {
    const root: XmlElement | undefined = parseXml(
      '<?xml version="1.0"?><!-- a note --><a xmlns="urn:x" b=\'1 &amp; 2\'><c d="&#x41;&#66;"/><e></e></a>',
    );

    expect(root?.name).toBe('a');
    expect([...(root?.attributes ?? [])]).toEqual([
      ['xmlns', 'urn:x'],
      ['b', '1 & 2'],
    ]);
    expect(root?.children.map((child: XmlElement): string => child.name)).toEqual(['c', 'e']);
    expect(root?.children[0]?.attributes.get('d')).toBe('AB');
  });

  it('formats_backToIndentedXml', () => {
    const root: XmlElement = parseXml('<a x="&lt;"><b/><c><d/></c></a>')!;

    expect(formatXml(root)).toBe('<a x="&lt;">\n  <b />\n  <c>\n    <d />\n  </c>\n</a>');
  });
});
