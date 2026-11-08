import type { LspServerSettingDescriptor } from '@shared/api/lsp-channels';

/**
 * The gopls settings a user is offered (#1211), on the Go page in Settings. gopls asks for its whole
 * `gopls` section through `workspace/configuration`, at start-up and again after every
 * `didChangeConfiguration`, so each is answered nested under it — `gopls.hints.parameterNames` reaches
 * it as `{ hints: { parameterNames: … } }` — and a change needs no restart.
 *
 * Every default is gopls's own, bar one: gopls sends no semantic tokens unless asked, so Go was left
 * with Monaco's grammar colouring alone. Studio asks, as VS Code's Go extension does.
 */
export const GOPLS_SETTINGS: readonly LspServerSettingDescriptor[] = [
  {
    section: 'gopls.semanticTokens',
    label: 'Semantic Colouring',
    description:
      'Colour types, functions, parameters and the rest by what the compiler knows they are, not only by how they look.',
    default: true,
  },
  {
    section: 'gopls.hints.parameterNames',
    label: 'Parameter Names',
    description: 'Show the name of the parameter each argument is passed to, before the argument.',
    default: false,
  },
  {
    section: 'gopls.hints.assignVariableTypes',
    label: 'Types of Assigned Variables',
    description: 'Show the type of each variable declared with :=, after its name.',
    default: false,
  },
  {
    section: 'gopls.hints.constantValues',
    label: 'Constant Values',
    description:
      'Show the value of each constant in a block that does not state one, such as iota.',
    default: false,
  },
  {
    section: 'gopls.hints.compositeLiteralFields',
    label: 'Field Names in Composite Literals',
    description: 'Show the name of each field a struct literal sets without naming it.',
    default: false,
  },
  {
    section: 'gopls.hints.rangeVariableTypes',
    label: 'Types of Range Variables',
    description: 'Show the types of the variables a range loop declares.',
    default: false,
    advanced: true,
  },
  {
    section: 'gopls.hints.compositeLiteralTypes',
    label: 'Types of Composite Literals',
    description:
      'Show the type of a composite literal whose type is left out, inside a slice or map.',
    default: false,
    advanced: true,
  },
  {
    section: 'gopls.hints.functionTypeParameters',
    label: 'Inferred Type Arguments',
    description: 'Show the type arguments the compiler infers for a call to a generic function.',
    default: false,
    advanced: true,
  },
  {
    section: 'gopls.staticcheck',
    label: 'Staticcheck',
    description:
      "Run staticcheck's checks as well as gopls's own, reporting what they find in the Error List.",
    default: false,
  },
  {
    section: 'gopls.gofumpt',
    label: 'Format With gofumpt',
    description: "Format Document lays code out with gofumpt's stricter rules rather than gofmt's.",
    default: false,
  },
  {
    section: 'gopls.usePlaceholders',
    label: 'Complete Function Calls',
    description:
      'Fill in the parentheses and parameters when a function is chosen from the completion list.',
    default: false,
  },
  {
    section: 'gopls.completeUnimported',
    label: 'Suggest Unimported Packages',
    description:
      'Suggest members of packages the file does not import yet, adding the import when one is chosen.',
    default: true,
    advanced: true,
  },
  {
    section: 'gopls.codelenses.generate',
    label: 'Run go generate Above Directives',
    description: 'Show a lens above each //go:generate directive that runs it.',
    default: true,
    advanced: true,
  },
  {
    section: 'gopls.codelenses.tidy',
    label: 'Tidy Lens in go.mod',
    description: 'Show a lens at the top of go.mod that runs go mod tidy.',
    default: true,
    advanced: true,
  },
  {
    section: 'gopls.codelenses.upgrade_dependency',
    label: 'Upgrade Lenses in go.mod',
    description:
      'Show lenses in go.mod that check for and apply newer versions of its dependencies.',
    default: true,
    advanced: true,
  },
  {
    section: 'gopls.codelenses.vendor',
    label: 'Vendor Lens in go.mod',
    description: 'Show a lens at the top of go.mod that runs go mod vendor.',
    default: true,
    advanced: true,
  },
  {
    section: 'gopls.codelenses.run_govulncheck',
    label: 'Vulnerability Check Lens in go.mod',
    description:
      "Show a lens at the top of go.mod that checks the module's dependencies for known vulnerabilities.",
    default: false,
    advanced: true,
  },
  {
    section: 'gopls.vulncheck',
    label: 'Check Imports for Vulnerabilities',
    description:
      'Check the packages the module imports against the Go vulnerability database as you edit, reporting what it finds in go.mod.',
    default: 'Off',
    options: [
      { value: 'Off', label: 'Off' },
      { value: 'Imports', label: 'Imported packages' },
    ],
    advanced: true,
  },
  {
    section: 'gopls.diagnosticsTrigger',
    label: 'Check Code',
    description:
      'When gopls checks a file for errors: as you type, or only when it is saved, which is lighter on a large module.',
    default: 'Edit',
    options: [
      { value: 'Edit', label: 'As you type' },
      { value: 'Save', label: 'On save' },
    ],
    advanced: true,
  },
];
