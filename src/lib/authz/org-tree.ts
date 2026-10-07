import type { OrgNode, OrgTree } from "./types";

export function buildOrgTree(tenantId: string, nodes: readonly OrgNode[]): OrgTree {
  const roots = nodes.filter((n) => n.parentId === null);
  if (roots.length !== 1)
    throw new Error(`Tenant ${tenantId} must have exactly one root org unit (found ${roots.length}).`);
  return {
    tenantId,
    root: roots[0]!,
    byId: new Map(nodes.map((n) => [n.id, n])),
    byCode: new Map(nodes.map((n) => [n.code, n])),
  };
}

/** True when `ancestor` is `node` or one of its ancestors. */
export function isWithin(node: OrgNode, ancestor: OrgNode): boolean {
  return node.path.startsWith(ancestor.path);
}

/** True when either node contains the other (used for "is this notice relevant to my scope"). */
export function overlaps(a: OrgNode, b: OrgNode): boolean {
  return isWithin(a, b) || isWithin(b, a);
}

export function ancestors(tree: OrgTree, node: OrgNode): OrgNode[] {
  const out: OrgNode[] = [];
  let cur: OrgNode | undefined = node;
  while (cur) {
    out.unshift(cur);
    cur = cur.parentId ? tree.byId.get(cur.parentId) : undefined;
  }
  return out;
}

export function descendantsOfType(tree: OrgTree, node: OrgNode, type: OrgNode["type"]): OrgNode[] {
  return [...tree.byId.values()]
    .filter((n) => n.type === type && isWithin(n, node))
    .sort((a, b) => a.code.localeCompare(b.code));
}

/** Section codes are "<DEPT>-<year>-<letter>" until cohorts become entities in Phase 2. */
export function parseSectionCode(
  code: string,
): { departmentCode: string; year: number; letter: string } | null {
  const m = /^([A-Z]+)-(\d)-([A-Z])$/.exec(code);
  return m ? { departmentCode: m[1]!, year: Number(m[2]), letter: m[3]! } : null;
}

/** Depth-first order with siblings sorted by type then code — for tree-shaped pickers and listings. */
export function depthFirst(tree: OrgTree): OrgNode[] {
  const typeOrder: Record<OrgNode["type"], number> = {
    institution: 0,
    campus: 1,
    school: 2,
    department: 3,
    section: 4,
    office: 5,
  };
  const children = new Map<string | null, OrgNode[]>();
  for (const n of tree.byId.values()) {
    const list = children.get(n.parentId) ?? [];
    list.push(n);
    children.set(n.parentId, list);
  }
  const out: OrgNode[] = [];
  const visit = (n: OrgNode) => {
    out.push(n);
    const kids = (children.get(n.id) ?? []).sort(
      (a, b) => typeOrder[a.type] - typeOrder[b.type] || a.code.localeCompare(b.code),
    );
    kids.forEach(visit);
  };
  visit(tree.root);
  return out;
}
