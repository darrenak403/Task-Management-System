const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` });
const sessionSecurity = [{ sessionCookie: [] }];
const body = (schema: string) => ({ required: true, content: { 'application/json': { schema: ref(schema) } } });
const jsonResponse = (description: string, schema?: string) => ({
  description,
  ...(schema ? { content: { 'application/json': { schema: ref(schema) } } } : {}),
});
const errorResponse = jsonResponse('A stable API error envelope.', 'ErrorEnvelope');
const pathParam = (name: string, description: string) => ({
  name,
  in: 'path',
  required: true,
  description,
  schema: { type: 'string', format: 'uuid' },
});
const pageParameters = [
  { name: 'page', in: 'query', required: false, schema: { type: 'integer', minimum: 1, default: 1 } },
  { name: 'pageSize', in: 'query', required: false, schema: { type: 'integer', minimum: 1, maximum: 100, default: 20 } },
];

function operation(input: {
  id: string;
  summary: string;
  successCode?: string;
  successDescription?: string;
  responseSchema?: string;
  requestSchema?: string;
  parameters?: unknown[];
  authenticated?: boolean;
  sessionCookie?: 'set' | 'clear';
  tags?: string[];
}) {
  const successCode = input.successCode ?? '200';
  const successResponse = jsonResponse(input.successDescription ?? 'Request completed.', input.responseSchema);
  return {
    operationId: input.id,
    summary: input.summary,
    tags: input.tags ?? ['Core'],
    ...(input.authenticated === false ? {} : { security: sessionSecurity }),
    ...(input.parameters ? { parameters: input.parameters } : {}),
    ...(input.requestSchema ? { requestBody: body(input.requestSchema) } : {}),
    responses: {
      [successCode]: {
        ...successResponse,
        ...(input.sessionCookie ? {
          headers: {
            'Set-Cookie': {
              description: input.sessionCookie === 'set' ? 'Sets the opaque session cookie.' : 'Expires the opaque session cookie.',
              schema: { type: 'string' },
            },
          },
        } : {}),
      },
      ...(successCode !== '400' ? { '400': errorResponse } : {}),
      ...(input.authenticated === false ? {} : { '401': errorResponse }),
      '403': errorResponse,
      '404': errorResponse,
      '409': errorResponse,
      '413': errorResponse,
      '415': errorResponse,
      '429': errorResponse,
      '500': errorResponse,
      ...(successCode === '503' ? {} : { '503': errorResponse }),
    },
  };
}

const workspaceId = pathParam('workspaceId', 'Workspace scope UUID.');
const teamId = pathParam('teamId', 'Team scope UUID within the workspace.');
const userId = pathParam('userId', 'User UUID.');
const taskId = pathParam('taskId', 'Task UUID within the team.');

export const openApiDocument = {
  openapi: '3.1.0',
  info: {
    title: 'Task Management System API',
    version: '0.2.0',
    description: 'Workspace/team-scoped API. Protected data is returned without shared caching. All mutations require the configured Origin or, when Origin is absent, a matching Referer.',
  },
  servers: [{ url: '/api' }],
  tags: [
    { name: 'Health' },
    { name: 'Auth' },
    { name: 'Workspaces' },
    { name: 'Teams' },
    { name: 'Tasks' },
    { name: 'Dashboard' },
    { name: 'Credentials' },
    { name: 'Realtime' },
    { name: 'AI Planner' },
    { name: 'Documentation' },
  ],
  paths: {
    '/health/live': {
      get: {
        operationId: 'getLiveness', summary: 'Check that the API process is running', tags: ['Health'],
        responses: { '200': { ...jsonResponse('The API process is alive.', 'HealthResponse'), headers: { 'X-Release-Sha': { description: 'Immutable image source commit when running a release image.', schema: { type: 'string', pattern: '^[a-fA-F0-9]{40,64}$' } } } } },
      },
    },
    '/health/ready': {
      get: {
        operationId: 'getReadiness', summary: 'Check whether the API can accept requests', tags: ['Health'],
        responses: {
          '200': { ...jsonResponse('The API is ready.', 'HealthResponse'), headers: { 'X-Release-Sha': { description: 'Immutable image source commit when running a release image.', schema: { type: 'string', pattern: '^[a-fA-F0-9]{40,64}$' } } } },
          '503': { ...jsonResponse('The API is not ready.', 'HealthResponse'), headers: { 'X-Release-Sha': { description: 'Immutable image source commit when running a release image.', schema: { type: 'string', pattern: '^[a-fA-F0-9]{40,64}$' } } } },
        },
      },
    },
    '/auth/register': { post: operation({ id: 'registerAccount', summary: 'Register an account and start a session', successCode: '201', requestSchema: 'RegisterRequest', responseSchema: 'UserResponse', authenticated: false, sessionCookie: 'set', tags: ['Auth'] }) },
    '/auth/login': { post: operation({ id: 'loginAccount', summary: 'Authenticate and rotate the current browser session', requestSchema: 'LoginRequest', responseSchema: 'UserResponse', authenticated: false, sessionCookie: 'set', tags: ['Auth'] }) },
    '/auth/logout': { post: operation({ id: 'logoutAccount', summary: 'Revoke the current session if present', successCode: '204', successDescription: 'Session revoked; the operation is idempotent.', authenticated: false, sessionCookie: 'clear', tags: ['Auth'] }) },
    '/auth/me': { get: operation({ id: 'getCurrentUser', summary: 'Read the current public user', responseSchema: 'UserResponse', tags: ['Auth'] }) },
    '/me/ai-provider-credentials/gemini': {
      get: operation({ id: 'getGeminiCredentialMetadata', summary: 'Read account-owned Gemini credential metadata only', responseSchema: 'GeminiCredentialMetadataResponse', tags: ['Credentials'] }),
      put: operation({ id: 'setGeminiCredential', summary: 'Verify and store the current account Gemini key and model', requestSchema: 'SetGeminiCredentialRequest', responseSchema: 'GeminiCredentialMetadataResponse', tags: ['Credentials'] }),
      patch: operation({ id: 'updateGeminiModel', summary: 'Verify and update the current account Gemini model', requestSchema: 'UpdateGeminiModelRequest', responseSchema: 'GeminiCredentialMetadataResponse', tags: ['Credentials'] }),
      delete: operation({ id: 'deleteGeminiCredential', summary: 'Delete the app copy of the current account key', successCode: '204', successDescription: 'Credential removed from this application.', tags: ['Credentials'] }),
    },
    '/me/ai-provider-credentials/gemini/test': {
      post: operation({ id: 'testGeminiCredential', summary: 'Check that the stored Gemini key still reaches the saved model', responseSchema: 'GeminiCredentialMetadataResponse', tags: ['Credentials'] }),
    },
    '/workspaces': {
      get: operation({ id: 'listWorkspaces', summary: 'List workspaces the current user belongs to', parameters: pageParameters, responseSchema: 'WorkspaceListResponse', tags: ['Workspaces'] }),
      post: operation({ id: 'createWorkspace', summary: 'Create a workspace and its owner membership atomically', successCode: '201', requestSchema: 'WorkspaceNameRequest', responseSchema: 'WorkspaceResponse', tags: ['Workspaces'] }),
    },
    '/workspaces/{workspaceId}': {
      get: operation({ id: 'getWorkspace', summary: 'Read a workspace visible to the current user', parameters: [workspaceId], responseSchema: 'WorkspaceResponse', tags: ['Workspaces'] }),
      patch: operation({ id: 'renameWorkspace', summary: 'Rename a workspace as owner or admin', parameters: [workspaceId], requestSchema: 'WorkspaceNameRequest', responseSchema: 'WorkspaceResponse', tags: ['Workspaces'] }),
    },
    '/workspaces/{workspaceId}/members': {
      get: operation({ id: 'listWorkspaceMembers', summary: 'List the workspace roster; owner/admin only', parameters: [workspaceId, ...pageParameters], responseSchema: 'WorkspaceMemberListResponse', tags: ['Workspaces'] }),
      post: operation({ id: 'addWorkspaceMember', summary: 'Add an existing account as a workspace member', successCode: '201', parameters: [workspaceId], requestSchema: 'AddWorkspaceMemberRequest', responseSchema: 'WorkspaceMemberResponse', tags: ['Workspaces'] }),
    },
    '/workspaces/{workspaceId}/member-candidates': {
      get: operation({ id: 'listWorkspaceMemberCandidates', summary: 'List up to 20 accounts that can be added to the workspace; owner/admin only', parameters: [workspaceId, { name: 'search', in: 'query', required: false, schema: { type: 'string', maxLength: 100 } }], responseSchema: 'MemberCandidateListResponse', tags: ['Workspaces'] }),
    },
    '/workspaces/{workspaceId}/members/{userId}': {
      patch: operation({ id: 'changeWorkspaceMemberRole', summary: 'Set ADMIN or MEMBER role; owner only', parameters: [workspaceId, userId], requestSchema: 'WorkspaceRoleRequest', responseSchema: 'WorkspaceMemberResponse', tags: ['Workspaces'] }),
      delete: operation({ id: 'removeWorkspaceMember', summary: 'Revoke a workspace member and clear their assignments atomically', successCode: '204', parameters: [workspaceId, userId], tags: ['Workspaces'] }),
    },
    '/workspaces/{workspaceId}/teams': {
      get: operation({ id: 'listTeams', summary: 'List teams visible in the workspace', parameters: [workspaceId, ...pageParameters], responseSchema: 'TeamListResponse', tags: ['Teams'] }),
      post: operation({ id: 'createTeam', summary: 'Create a team as owner or admin', successCode: '201', parameters: [workspaceId], requestSchema: 'TeamNameRequest', responseSchema: 'TeamResponse', tags: ['Teams'] }),
    },
    '/workspaces/{workspaceId}/teams/{teamId}': {
      get: operation({ id: 'getTeam', summary: 'Read a team visible to the current user', parameters: [workspaceId, teamId], responseSchema: 'TeamResponse', tags: ['Teams'] }),
      patch: operation({ id: 'renameTeam', summary: 'Rename a team as owner or admin', parameters: [workspaceId, teamId], requestSchema: 'TeamNameRequest', responseSchema: 'TeamResponse', tags: ['Teams'] }),
    },
    '/workspaces/{workspaceId}/teams/{teamId}/members': {
      get: operation({ id: 'listTeamMembers', summary: 'List a visible team roster for task assignment', parameters: [workspaceId, teamId, ...pageParameters], responseSchema: 'UserListResponse', tags: ['Teams'] }),
      post: operation({ id: 'addTeamMember', summary: 'Add a workspace member to a team; owner/admin only', successCode: '201', parameters: [workspaceId, teamId], requestSchema: 'AddTeamMemberRequest', responseSchema: 'TeamMemberResponse', tags: ['Teams'] }),
    },
    '/workspaces/{workspaceId}/teams/{teamId}/members/{userId}': {
      delete: operation({ id: 'removeTeamMember', summary: 'Remove a team member and clear their assignments atomically', successCode: '204', parameters: [workspaceId, teamId, userId], tags: ['Teams'] }),
    },
    '/workspaces/{workspaceId}/tasks': {
      get: operation({
        id: 'listTasks', summary: 'Search and filter tasks within teams the user can view',
        parameters: [workspaceId, ...pageParameters,
          { name: 'q', in: 'query', schema: { type: 'string', maxLength: 200 } },
          { name: 'status', in: 'query', schema: ref('TaskStatus') },
          { name: 'priority', in: 'query', schema: ref('TaskPriority') },
          { name: 'teamId', in: 'query', schema: { type: 'string', format: 'uuid' } },
          { name: 'assigneeId', in: 'query', schema: { type: 'string', format: 'uuid' } },
        ], responseSchema: 'TaskListResponse', tags: ['Tasks'],
      }),
    },
    '/workspaces/{workspaceId}/teams/{teamId}/tasks': {
      post: operation({ id: 'createTask', summary: 'Create a task in a visible team', successCode: '201', parameters: [workspaceId, teamId], requestSchema: 'CreateTaskRequest', responseSchema: 'TaskResponse', tags: ['Tasks'] }),
    },
    '/workspaces/{workspaceId}/teams/{teamId}/tasks/{taskId}': {
      get: operation({ id: 'getTask', summary: 'Read a task whose workspace/team matches the URL', parameters: [workspaceId, teamId, taskId], responseSchema: 'TaskResponse', tags: ['Tasks'] }),
      patch: operation({ id: 'updateTask', summary: 'Update allowlisted task fields in a visible team', parameters: [workspaceId, teamId, taskId], requestSchema: 'UpdateTaskRequest', responseSchema: 'TaskResponse', tags: ['Tasks'] }),
      delete: operation({ id: 'deleteTask', summary: 'Delete a task according to workspace/team role', successCode: '204', parameters: [workspaceId, teamId, taskId], tags: ['Tasks'] }),
    },
    '/workspaces/{workspaceId}/teams/{teamId}/tasks/{taskId}/dependencies': {
      patch: operation({ id: 'replaceTaskDependencies', summary: 'Replace prerequisites under the team graph lock with optimistic concurrency', parameters: [workspaceId, teamId, taskId], requestSchema: 'TaskDependenciesRequest', responseSchema: 'TaskDependenciesResponse', tags: ['Tasks'] }),
    },
    '/workspaces/{workspaceId}/dashboard': {
      get: operation({ id: 'getDashboard', summary: 'Read role-scoped task counts and the next seven calendar days', parameters: [workspaceId, { name: 'teamId', in: 'query', schema: { type: 'string', format: 'uuid' } }], responseSchema: 'DashboardResponse', tags: ['Dashboard'] }),
    },
    '/realtime/events': {
      get: {
        operationId: 'streamRealtimeEvents', summary: 'Subscribe to authorized workspace or team changes', tags: ['Realtime'], security: sessionSecurity,
        description: 'SSE event types: team.tasks_changed, team.roster_changed, workspace.structure_changed, access.changed, auth.revoked, planner.job_changed, ready, resync_required, server.unavailable, and server.draining. Task invalidations include resourceId and a safe UTC revision when available. Planner events are targeted to the plan creator and include only stage/status summaries. Last-Event-ID takes precedence over cursor. Initial/resync ready checkpoints require one snapshot read; resume replays authorized events through a watermark. Unknown, expired, or oversized replay cursors return resync_required. The bootstrap deadline is five seconds; no polling fallback is provided.',
        parameters: [
          { name: 'workspaceId', in: 'query', required: true, schema: { type: 'string', format: 'uuid' } },
          { name: 'teamId', in: 'query', required: false, schema: { type: 'string', format: 'uuid' } },
          { name: 'cursor', in: 'query', required: false, schema: { type: 'string', format: 'uuid' } },
          { name: 'Last-Event-ID', in: 'header', required: false, schema: { type: 'string', format: 'uuid' } },
        ],
        responses: {
          '200': { description: 'UTF-8 SSE stream; no Content-Length, no-store/no-transform, and buffering disabled.', headers: { 'Cache-Control': { schema: { type: 'string', const: 'no-store, no-transform' } }, 'X-Accel-Buffering': { schema: { type: 'string', const: 'no' } } }, content: { 'text/event-stream': { schema: { type: 'string', description: 'SSE frames use opaque UUID ids. Event payloads contain schemaVersion, type, authorized scope/resource IDs, task revision when available, and safe invalidation metadata.' } } } },
          '400': errorResponse, '401': errorResponse, '403': errorResponse, '404': errorResponse, '429': errorResponse, '503': errorResponse,
        },
      },
    },
    '/workspaces/{workspaceId}/teams/{teamId}/ai-plans': {
      get: operation({ id: 'listAiPlans', summary: 'List current-user plans and AI availability for this team', parameters: [workspaceId, teamId, ...pageParameters], responseSchema: 'AiPlanListResponse', tags: ['AI Planner'] }),
      post: operation({ id: 'createAiPlanJob', summary: 'Create a private plan and enqueue a durable BYOK generation job', successCode: '202', parameters: [workspaceId, teamId], requestSchema: 'CreateAiPlanRequest', responseSchema: 'EnqueuedAiJobResponse', tags: ['AI Planner'] }),
    },
    '/workspaces/{workspaceId}/teams/{teamId}/ai-plans/{planId}': {
      get: operation({ id: 'getAiPlan', summary: 'Read the current user-owned plan and its active draft version', parameters: [workspaceId, teamId, pathParam('planId', 'AI plan UUID.')], responseSchema: 'AiPlanResponse', tags: ['AI Planner'] }),
    },
    '/workspaces/{workspaceId}/teams/{teamId}/ai-plans/{planId}/generate': {
      post: operation({ id: 'generateAiPlanRevision', summary: 'Retry generation or queue a targeted immutable revision candidate', successCode: '202', parameters: [workspaceId, teamId, pathParam('planId', 'AI plan UUID.')], requestSchema: 'GenerateAiRevisionRequest', responseSchema: 'EnqueuedAiJobResponse', tags: ['AI Planner'] }),
    },
    '/workspaces/{workspaceId}/teams/{teamId}/ai-plans/{planId}/confirm': {
      post: {
        ...operation({ id: 'confirmAiPlan', summary: 'Atomically import the exact selected version and persist its replay receipt', successCode: '201', parameters: [workspaceId, teamId, pathParam('planId', 'AI plan UUID.')], requestSchema: 'ConfirmAiPlanRequest', responseSchema: 'AiImportReceiptResponse', tags: ['AI Planner'] }),
        responses: {
          ...operation({ id: 'confirmAiPlan', summary: 'Atomically import the exact selected version and persist its replay receipt', successCode: '201', parameters: [workspaceId, teamId, pathParam('planId', 'AI plan UUID.')], requestSchema: 'ConfirmAiPlanRequest', responseSchema: 'AiImportReceiptResponse', tags: ['AI Planner'] }).responses,
          '200': jsonResponse('The prior import receipt was replayed after an ambiguous or repeated request.', 'AiImportReceiptResponse'),
        },
      },
    },
    '/workspaces/{workspaceId}/teams/{teamId}/ai-plans/{planId}/clone': {
      post: operation({ id: 'cloneAiPlan', summary: 'Clone a plan into an unselected draft with safe task context removed', successCode: '201', parameters: [workspaceId, teamId, pathParam('planId', 'AI plan UUID.')], requestSchema: 'CloneAiPlanRequest', responseSchema: 'AiPlanCloneResponse', tags: ['AI Planner'] }),
    },
    '/workspaces/{workspaceId}/teams/{teamId}/ai-plans/{planId}/versions': {
      get: operation({ id: 'listAiPlanVersions', summary: 'Read paginated immutable version history metadata', parameters: [workspaceId, teamId, pathParam('planId', 'AI plan UUID.'), ...pageParameters], responseSchema: 'AiPlanVersionListResponse', tags: ['AI Planner'] }),
      post: operation({ id: 'saveAiPlanVersion', summary: 'Save a manual immutable edit with active-version compare-and-swap', successCode: '201', parameters: [workspaceId, teamId, pathParam('planId', 'AI plan UUID.')], requestSchema: 'SaveAiPlanVersionRequest', responseSchema: 'AiPlanVersionResponse', tags: ['AI Planner'] }),
    },
    '/workspaces/{workspaceId}/teams/{teamId}/ai-plans/{planId}/versions/{versionId}': {
      get: operation({ id: 'getAiPlanVersion', summary: 'Read an immutable plan snapshot for review or client-side diff', parameters: [workspaceId, teamId, pathParam('planId', 'AI plan UUID.'), pathParam('versionId', 'AI plan version UUID.')], responseSchema: 'AiPlanVersionResponse', tags: ['AI Planner'] }),
    },
    '/workspaces/{workspaceId}/teams/{teamId}/ai-plans/{planId}/versions/{versionId}/activate': {
      post: operation({ id: 'activateAiPlanCandidate', summary: 'Accept a candidate only while its base version is still active', parameters: [workspaceId, teamId, pathParam('planId', 'AI plan UUID.'), pathParam('versionId', 'AI plan version UUID.')], requestSchema: 'ActivateAiPlanVersionRequest', responseSchema: 'AiPlanActivationResponse', tags: ['AI Planner'] }),
    },
    '/workspaces/{workspaceId}/teams/{teamId}/ai-jobs': {
      get: operation({ id: 'findAiJobByRequestKey', summary: 'Recover a prior enqueue result by its request key', parameters: [workspaceId, teamId, { name: 'requestKey', in: 'query', required: true, schema: { type: 'string', minLength: 8, maxLength: 128 } }], responseSchema: 'AiJobResponse', tags: ['AI Planner'] }),
    },
    '/workspaces/{workspaceId}/teams/{teamId}/ai-jobs/{jobId}': {
      get: operation({ id: 'getAiJob', summary: 'Read own job status, honest stages, and safe clarification questions', parameters: [workspaceId, teamId, pathParam('jobId', 'AI job UUID.')], responseSchema: 'AiJobResponse', tags: ['AI Planner'] }),
    },
    '/workspaces/{workspaceId}/teams/{teamId}/ai-jobs/{jobId}/clarify': {
      post: operation({ id: 'clarifyAiJob', summary: 'Answer one clarification round for an owned AI job', successCode: '202', parameters: [workspaceId, teamId, pathParam('jobId', 'AI job UUID.')], requestSchema: 'ClarifyAiJobRequest', responseSchema: 'AiJobActionResponse', tags: ['AI Planner'] }),
    },
    '/workspaces/{workspaceId}/teams/{teamId}/ai-jobs/{jobId}/cancel': {
      post: operation({ id: 'cancelAiJob', summary: 'Cancel the local job lifecycle; provider cancellation is best effort', parameters: [workspaceId, teamId, pathParam('jobId', 'AI job UUID.')], responseSchema: 'AiJobResponse', tags: ['AI Planner'] }),
    },
    '/openapi.json': { get: { operationId: 'getOpenApiDocument', summary: 'Read this OpenAPI contract', tags: ['Documentation'], responses: { '200': { description: 'OpenAPI document.', content: { 'application/json': { schema: { type: 'object', required: ['openapi', 'info', 'paths'] } } } } } } },
    '/docs': { get: { operationId: 'getApiDocs', summary: 'Open interactive Swagger UI', tags: ['Documentation'], responses: { '200': { description: 'Swagger UI HTML.' } } } },
  },
  components: {
    securitySchemes: {
      sessionCookie: { type: 'apiKey', in: 'cookie', name: 'tm_session', description: 'Opaque server-side session cookie; HttpOnly and Secure in production.' },
    },
    schemas: {
      HealthResponse: { type: 'object', required: ['status'], properties: { status: { type: 'string', enum: ['ok', 'unavailable'] } } },
      ErrorEnvelope: {
        type: 'object', required: ['error'], properties: {
          error: { type: 'object', required: ['code', 'message', 'requestId'], properties: {
            code: { type: 'string' }, message: { type: 'string' }, requestId: { type: 'string' },
          } },
        },
      },
      EmptyObject: { type: 'object', additionalProperties: false },
      UserDto: {
        type: 'object', required: ['id', 'email', 'displayName'], properties: {
          id: { type: 'string', format: 'uuid' }, email: { type: 'string', format: 'email' }, displayName: { type: ['string', 'null'] },
        },
      },
      UserResponse: { type: 'object', required: ['data'], properties: { data: ref('UserDto') } },
      RegisterRequest: {
        type: 'object', additionalProperties: false, required: ['email', 'password'], properties: {
          email: { type: 'string', format: 'email', maxLength: 254 }, password: { type: 'string', minLength: 8, maxLength: 128 }, displayName: { type: 'string', minLength: 1, maxLength: 80 },
        },
      },
      LoginRequest: { type: 'object', additionalProperties: false, required: ['email', 'password'], properties: { email: { type: 'string', format: 'email' }, password: { type: 'string', minLength: 8, maxLength: 128 } } },
      WorkspaceNameRequest: { type: 'object', additionalProperties: false, required: ['name'], properties: { name: { type: 'string', minLength: 1, maxLength: 100 } } },
      WorkspaceDto: { type: 'object', required: ['id', 'name', 'role', 'createdAt', 'updatedAt'], properties: { id: { type: 'string', format: 'uuid' }, name: { type: 'string' }, role: { $ref: '#/components/schemas/WorkspaceRole' }, createdAt: { type: 'string', format: 'date-time' }, updatedAt: { type: 'string', format: 'date-time' } } },
      WorkspaceResponse: { type: 'object', required: ['data'], properties: { data: ref('WorkspaceDto') } },
      WorkspaceRole: { type: 'string', enum: ['OWNER', 'ADMIN', 'MEMBER'] },
      WorkspaceRoleRequest: { type: 'object', additionalProperties: false, required: ['role'], properties: { role: { type: 'string', enum: ['ADMIN', 'MEMBER'] } } },
      AddWorkspaceMemberRequest: { type: 'object', additionalProperties: false, required: ['email'], properties: { email: { type: 'string', format: 'email', maxLength: 254 } } },
      WorkspaceMemberDto: { type: 'object', required: ['id', 'email', 'displayName', 'role', 'createdAt'], properties: { id: { type: 'string', format: 'uuid' }, email: { type: 'string', format: 'email' }, displayName: { type: ['string', 'null'] }, role: { $ref: '#/components/schemas/WorkspaceRole' }, createdAt: { type: 'string', format: 'date-time' } } },
      WorkspaceMemberResponse: { type: 'object', required: ['data'], properties: { data: ref('WorkspaceMemberDto') } },
      TeamNameRequest: { type: 'object', additionalProperties: false, required: ['name'], properties: { name: { type: 'string', minLength: 1, maxLength: 100 } } },
      TeamDto: { type: 'object', required: ['id', 'workspaceId', 'name', 'createdAt', 'updatedAt'], properties: { id: { type: 'string', format: 'uuid' }, workspaceId: { type: 'string', format: 'uuid' }, name: { type: 'string' }, createdAt: { type: 'string', format: 'date-time' }, updatedAt: { type: 'string', format: 'date-time' } } },
      TeamResponse: { type: 'object', required: ['data'], properties: { data: ref('TeamDto') } },
      TeamMemberDto: { allOf: [ref('UserDto'), { type: 'object', required: ['createdAt'], properties: { createdAt: { type: 'string', format: 'date-time' } } }] },
      TeamMemberResponse: { type: 'object', required: ['data'], properties: { data: ref('TeamMemberDto') } },
      AddTeamMemberRequest: { type: 'object', additionalProperties: false, required: ['userId'], properties: { userId: { type: 'string', format: 'uuid' } } },
      PageMeta: { type: 'object', required: ['page', 'pageSize', 'total', 'totalPages'], properties: { page: { type: 'integer' }, pageSize: { type: 'integer' }, total: { type: 'integer' }, totalPages: { type: 'integer' } } },
      WorkspaceListResponse: { type: 'object', required: ['data', 'meta'], properties: { data: { type: 'array', items: ref('WorkspaceDto') }, meta: ref('PageMeta') } },
      MemberCandidateListResponse: { type: 'object', required: ['data'], properties: { data: { type: 'array', items: ref('UserDto') } } },
      WorkspaceMemberListResponse: { type: 'object', required: ['data', 'meta'], properties: { data: { type: 'array', items: ref('WorkspaceMemberDto') }, meta: ref('PageMeta') } },
      TeamListResponse: { type: 'object', required: ['data', 'meta'], properties: { data: { type: 'array', items: ref('TeamDto') }, meta: ref('PageMeta') } },
      UserListResponse: { type: 'object', required: ['data', 'meta'], properties: { data: { type: 'array', items: ref('TeamMemberDto') }, meta: ref('PageMeta') } },
      TaskStatus: { type: 'string', enum: ['TODO', 'IN_PROGRESS', 'DONE'] },
      TaskPriority: { type: 'string', enum: ['LOW', 'MEDIUM', 'HIGH'] },
      TaskSchedule: { oneOf: [
        { type: 'object', additionalProperties: false, required: ['mode'], properties: { mode: { const: 'NONE' } } },
        { type: 'object', additionalProperties: false, required: ['mode', 'startDay', 'dueDay'], properties: { mode: { const: 'RELATIVE' }, startDay: { type: ['integer', 'null'], minimum: 1, maximum: 365 }, dueDay: { type: ['integer', 'null'], minimum: 1, maximum: 365 } } },
        { type: 'object', additionalProperties: false, required: ['mode', 'startDate', 'dueDate'], properties: { mode: { const: 'ABSOLUTE' }, startDate: { type: ['string', 'null'], format: 'date' }, dueDate: { type: ['string', 'null'], format: 'date' } } },
      ] },
      TaskChecklistItem: { type: 'object', required: ['id', 'position', 'title', 'isCompleted'], properties: { id: { type: 'string', format: 'uuid' }, position: { type: 'integer', minimum: 0 }, title: { type: 'string', maxLength: 200 }, isCompleted: { type: 'boolean' } } },
      TaskChecklistInput: { type: 'object', additionalProperties: false, required: ['title'], properties: { id: { type: 'string', format: 'uuid' }, title: { type: 'string', minLength: 1, maxLength: 200 }, isCompleted: { type: 'boolean', default: false } } },
      CreateTaskRequest: { type: 'object', additionalProperties: false, required: ['title'], properties: { title: { type: 'string', minLength: 1, maxLength: 200 }, description: { type: 'string', maxLength: 5000 }, status: ref('TaskStatus'), priority: ref('TaskPriority'), dueDate: { type: ['string', 'null'], format: 'date' }, assigneeId: { type: ['string', 'null'], format: 'uuid' }, completionCriteria: { type: 'string', maxLength: 2000 }, priorityReason: { type: 'string', maxLength: 1000 }, estimateMinMinutes: { type: ['integer', 'null'], minimum: 1, maximum: 525600 }, estimateMaxMinutes: { type: ['integer', 'null'], minimum: 1, maximum: 525600 }, schedule: ref('TaskSchedule'), checklist: { type: 'array', maxItems: 10, items: ref('TaskChecklistInput') } } },
      UpdateTaskRequest: { type: 'object', additionalProperties: false, minProperties: 1, properties: { title: { type: 'string', minLength: 1, maxLength: 200 }, description: { type: 'string', maxLength: 5000 }, status: ref('TaskStatus'), priority: ref('TaskPriority'), dueDate: { type: ['string', 'null'], format: 'date' }, assigneeId: { type: ['string', 'null'], format: 'uuid' }, completionCriteria: { type: 'string', maxLength: 2000 }, priorityReason: { type: 'string', maxLength: 1000 }, estimateMinMinutes: { type: ['integer', 'null'], minimum: 1, maximum: 525600 }, estimateMaxMinutes: { type: ['integer', 'null'], minimum: 1, maximum: 525600 }, schedule: ref('TaskSchedule'), checklist: { type: 'array', maxItems: 10, items: ref('TaskChecklistInput') } } },
      TaskDto: { type: 'object', required: ['id', 'workspaceId', 'teamId', 'createdBy', 'assigneeId', 'title', 'description', 'status', 'priority', 'dueDate', 'completionCriteria', 'priorityReason', 'estimateMinMinutes', 'estimateMaxMinutes', 'schedule', 'checklist', 'dependencies', 'createdAt', 'updatedAt'], properties: { id: { type: 'string', format: 'uuid' }, workspaceId: { type: 'string', format: 'uuid' }, teamId: { type: 'string', format: 'uuid' }, createdBy: { type: 'string', format: 'uuid' }, assigneeId: { type: ['string', 'null'], format: 'uuid' }, title: { type: 'string' }, description: { type: 'string' }, status: ref('TaskStatus'), priority: ref('TaskPriority'), dueDate: { type: ['string', 'null'], format: 'date' }, completionCriteria: { type: 'string' }, priorityReason: { type: 'string' }, estimateMinMinutes: { type: ['integer', 'null'] }, estimateMaxMinutes: { type: ['integer', 'null'] }, schedule: ref('TaskSchedule'), checklist: { type: 'array', items: ref('TaskChecklistItem') }, dependencies: { type: 'object', required: ['prerequisites', 'dependents'], properties: { prerequisites: { type: 'array', items: { type: 'string', format: 'uuid' } }, dependents: { type: 'array', items: { type: 'string', format: 'uuid' } } } }, createdAt: { type: 'string', format: 'date-time' }, updatedAt: { type: 'string', format: 'date-time' } } },
      TaskDependenciesRequest: { type: 'object', additionalProperties: false, required: ['prerequisiteIds', 'expectedUpdatedAt'], properties: { prerequisiteIds: { type: 'array', maxItems: 100, uniqueItems: true, items: { type: 'string', format: 'uuid' } }, expectedUpdatedAt: { type: 'string', format: 'date-time' } } },
      TaskDependenciesResponse: { type: 'object', required: ['data'], properties: { data: { type: 'object', required: ['taskId', 'prerequisiteIds', 'updatedAt'], properties: { taskId: { type: 'string', format: 'uuid' }, prerequisiteIds: { type: 'array', items: { type: 'string', format: 'uuid' } }, updatedAt: { type: 'string', format: 'date-time' } } } } },
      TaskResponse: { type: 'object', required: ['data'], properties: { data: ref('TaskDto') } },
      TaskListResponse: { type: 'object', required: ['data', 'meta'], properties: { data: { type: 'array', items: ref('TaskDto') }, meta: ref('PageMeta') } },
      DashboardResponse: { type: 'object', required: ['data'], properties: { data: { type: 'object', required: ['scope', 'counts', 'upcoming', 'upcomingTotal', 'window'], properties: { scope: { type: 'object', required: ['workspaceId', 'teamId'], properties: { workspaceId: { type: 'string', format: 'uuid' }, teamId: { type: ['string', 'null'], format: 'uuid' } } }, counts: { type: 'object', required: ['total', 'todo', 'inProgress', 'done'], properties: { total: { type: 'integer' }, todo: { type: 'integer' }, inProgress: { type: 'integer' }, done: { type: 'integer' } } }, upcoming: { type: 'array', items: ref('TaskDto') }, upcomingTotal: { type: 'integer' }, window: { type: 'object', required: ['from', 'to', 'timeZone'], properties: { from: { type: 'string', format: 'date' }, to: { type: 'string', format: 'date' }, timeZone: { type: 'string', const: 'Asia/Ho_Chi_Minh' } } } } } } },
      SetGeminiCredentialRequest: { type: 'object', additionalProperties: false, required: ['key', 'model'], properties: { key: { type: 'string', minLength: 20, maxLength: 512 }, model: { type: 'string', minLength: 1, maxLength: 128, pattern: '^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$' } } },
      UpdateGeminiModelRequest: { type: 'object', additionalProperties: false, required: ['model'], properties: { model: { type: 'string', minLength: 1, maxLength: 128, pattern: '^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$' } } },
      GeminiCredentialMetadata: { type: 'object', required: ['configured', 'model', 'verifiedAt', 'credentialRevision'], properties: { configured: { type: 'boolean' }, model: { type: ['string', 'null'] }, verifiedAt: { type: ['string', 'null'], format: 'date-time' }, credentialRevision: { type: ['string', 'null'], format: 'uuid' } } },
      GeminiCredentialMetadataResponse: { type: 'object', required: ['data'], properties: { data: ref('GeminiCredentialMetadata') } },
      AiPlannerStatus: { type: 'object', required: ['available', 'model', 'credentialRequired', 'dailyUsage', 'unavailableReason'], properties: { dailyUsage: { type: 'object', description: "The signed-in user's AI operations today (Asia/Ho_Chi_Minh day) against their daily limit, and how many provider calls one request may make.", required: ['used', 'limit', 'attemptsPerRequest'], properties: { used: { type: 'integer' }, limit: { type: 'integer' }, attemptsPerRequest: { type: 'integer' } } }, available: { type: 'boolean' }, model: { type: ['string', 'null'] }, credentialRequired: { type: 'boolean' }, unavailableReason: { type: ['string', 'null'], enum: ['disabled', 'invalid_configuration', 'restore_quarantine', 'credential_required', 'model_required', null] } } },
      AiPlannerStatusResponse: { type: 'object', required: ['data'], properties: { data: ref('AiPlannerStatus') } },
      CreateAiPlanRequest: {
        type: 'object', additionalProperties: false, required: ['requestKey', 'goal', 'consent'],
        properties: {
          requestKey: { type: 'string', minLength: 8, maxLength: 128, pattern: '^[A-Za-z0-9._:-]+$' },
          goal: { type: 'string', minLength: 20, maxLength: 4000 }, constraints: { type: 'string', maxLength: 4000 },
          detailLevel: { type: 'string', enum: ['SIMPLE', 'BALANCED', 'DETAILED'] }, strategy: { type: 'string', enum: ['FASTEST', 'BALANCED', 'QUALITY_FIRST'] },
          startDate: { type: ['string', 'null'], format: 'date' }, targetDate: { type: ['string', 'null'], format: 'date' }, durationDays: { type: ['integer', 'null'], minimum: 1, maximum: 365 },
          includeExistingTasks: { type: 'boolean', default: false }, existingTaskIds: { type: 'array', maxItems: 50, uniqueItems: true, items: { type: 'string', format: 'uuid' } },
          includeMembers: { type: 'boolean', default: false }, memberIds: { type: 'array', maxItems: 20, uniqueItems: true, items: { type: 'string', format: 'uuid' } },
          memberProfiles: { type: 'array', maxItems: 20, description: 'User-confirmed role, daily capacity, and working days for selected members.', items: { type: 'object', additionalProperties: false, required: ['userId'], properties: { userId: { type: 'string', format: 'uuid' }, role: { type: ['string', 'null'], maxLength: 80 }, capacityMinutesPerDay: { type: ['integer', 'null'], minimum: 1, maximum: 1440 }, workingDays: { type: 'array', uniqueItems: true, maxItems: 7, items: { type: 'integer', minimum: 0, maximum: 6 } } } } },
          consent: { type: 'object', additionalProperties: false, required: ['providerDisclosureAccepted', 'billingAuthorityConfirmed', 'selectedContextReviewed'], properties: { providerDisclosureAccepted: { type: 'boolean', const: true }, billingAuthorityConfirmed: { type: 'boolean', const: true }, selectedContextReviewed: { type: 'boolean', const: true } } },
        },
      },
      EnqueuedAiJob: { type: 'object', required: ['planId', 'jobId', 'status', 'requestKey'], properties: { planId: { type: 'string', format: 'uuid' }, jobId: { type: 'string', format: 'uuid' }, status: { type: 'string', enum: ['QUEUED', 'RUNNING', 'NEEDS_CLARIFICATION', 'SUCCEEDED', 'FAILED', 'CANCELLED', 'INTERRUPTED'] }, requestKey: { type: 'string' } } },
      EnqueuedAiJobResponse: { type: 'object', required: ['data'], properties: { data: ref('EnqueuedAiJob') } },
      AiPlannerStage: { type: 'object', required: ['key', 'label', 'status', 'startedAt', 'completedAt', 'summary'], properties: { key: { type: 'string' }, label: { type: 'string' }, status: { type: 'string', enum: ['pending', 'active', 'completed', 'failed', 'skipped'] }, startedAt: { type: ['string', 'null'], format: 'date-time' }, completedAt: { type: ['string', 'null'], format: 'date-time' }, summary: { type: ['string', 'null'] } } },
      AiJob: { type: 'object', required: ['id', 'planId', 'status', 'currentStage', 'sequence', 'stages', 'outputVersionId', 'safeErrorCode', 'model', 'clarificationQuestions', 'createdAt', 'startedAt', 'finishedAt', 'expiresAt'], properties: { id: { type: 'string', format: 'uuid' }, planId: { type: 'string', format: 'uuid' }, status: { type: 'string', enum: ['QUEUED', 'RUNNING', 'NEEDS_CLARIFICATION', 'SUCCEEDED', 'FAILED', 'CANCELLED', 'INTERRUPTED'] }, currentStage: { type: ['string', 'null'] }, sequence: { type: 'integer' }, stages: { type: 'array', items: ref('AiPlannerStage') }, outputVersionId: { type: ['string', 'null'], format: 'uuid' }, safeErrorCode: { type: ['string', 'null'] }, model: { type: 'string' }, clarificationQuestions: { type: 'array', items: { type: 'string' } }, createdAt: { type: 'string', format: 'date-time' }, startedAt: { type: ['string', 'null'], format: 'date-time' }, finishedAt: { type: ['string', 'null'], format: 'date-time' }, expiresAt: { type: 'string', format: 'date-time' } } },
      AiJobResponse: { type: 'object', required: ['data'], properties: { data: ref('AiJob') } },
      AiJobActionResponse: { type: 'object', required: ['data'], properties: { data: { type: 'object', required: ['id', 'status'], properties: { id: { type: 'string', format: 'uuid' }, status: { type: 'string' } } } } },
      ClarifyAiJobRequest: { type: 'object', additionalProperties: false, required: ['requestKey'], properties: { requestKey: { type: 'string', minLength: 8, maxLength: 128 }, answers: { type: 'array', minItems: 1, maxItems: 3, items: { type: 'string', minLength: 1, maxLength: 1000 } }, allowAssumptions: { type: 'boolean' } } },
      PlannerFieldLock: { type: 'object', additionalProperties: false, required: ['itemId', 'field'], properties: { itemId: { type: 'string', format: 'uuid' }, field: { type: 'string', enum: ['title', 'description', 'completionCriteria', 'priority', 'priorityReason', 'estimateMinMinutes', 'estimateMaxMinutes', 'schedule', 'checklist', 'suggestedRole', 'assigneeId'] } } },
      PlanDraftItem: { type: 'object', additionalProperties: false, required: ['id', 'title', 'description', 'completionCriteria', 'priority', 'priorityReason', 'estimateMinMinutes', 'estimateMaxMinutes', 'schedule', 'dependencies', 'checklist', 'suggestedRole', 'selected', 'assigneeId', 'position'], properties: { id: { type: 'string', format: 'uuid' }, title: { type: 'string', maxLength: 200 }, description: { type: 'string', maxLength: 5000 }, completionCriteria: { type: 'string', maxLength: 2000 }, priority: ref('TaskPriority'), priorityReason: { type: 'string', maxLength: 1000 }, estimateMinMinutes: { type: ['integer', 'null'] }, estimateMaxMinutes: { type: ['integer', 'null'] }, schedule: ref('TaskSchedule'), dependencies: { type: 'array', maxItems: 20, uniqueItems: true, items: { type: 'string', format: 'uuid' } }, checklist: { type: 'array', maxItems: 10, items: { type: 'string', maxLength: 200 } }, suggestedRole: { type: ['string', 'null'], maxLength: 80 }, selected: { type: 'boolean' }, assigneeId: { type: ['string', 'null'], format: 'uuid' }, position: { type: 'integer', minimum: 0, maximum: 19 } } },
      PlanDraftContent: { type: 'object', additionalProperties: false, required: ['planTitle', 'goalSummary', 'assumptions', 'warnings', 'items'], properties: { planTitle: { type: 'string', maxLength: 120 }, goalSummary: { type: 'string', maxLength: 2000 }, assumptions: { type: 'array', maxItems: 10, items: { type: 'string', maxLength: 500 } }, warnings: { type: 'array', maxItems: 20, items: { type: 'string', maxLength: 500 } }, items: { type: 'array', minItems: 1, maxItems: 20, items: ref('PlanDraftItem') } } },
      SaveAiPlanVersionRequest: { type: 'object', additionalProperties: false, required: ['expectedActiveVersionId', 'draft'], properties: { expectedActiveVersionId: { type: ['string', 'null'], format: 'uuid' }, draft: ref('PlanDraftContent'), fieldLocks: { type: 'array', maxItems: 220, items: ref('PlannerFieldLock') } } },
      ActivateAiPlanVersionRequest: { type: 'object', additionalProperties: false, required: ['expectedActiveVersionId'], properties: { expectedActiveVersionId: { type: ['string', 'null'], format: 'uuid' } } },
      GenerateAiRevisionRequest: { type: 'object', additionalProperties: false, required: ['requestKey', 'action', 'baseVersionId'], properties: { requestKey: { type: 'string', minLength: 8, maxLength: 128 }, action: { type: 'string', enum: ['RETRY', 'REGENERATE', 'SIMPLIFY', 'ADD_DETAIL', 'ADJUST_DEADLINE'] }, retryJobId: { type: 'string', format: 'uuid' }, baseVersionId: { type: ['string', 'null'], format: 'uuid' }, itemIds: { type: 'array', maxItems: 20, uniqueItems: true, items: { type: 'string', format: 'uuid' } }, fieldMask: { type: 'array', maxItems: 10, uniqueItems: true, items: { type: 'string', enum: ['title', 'description', 'completionCriteria', 'priority', 'priorityReason', 'estimateMinMinutes', 'estimateMaxMinutes', 'schedule', 'checklist', 'suggestedRole'] } }, overrideLocks: { type: 'array', maxItems: 220, items: ref('PlannerFieldLock') }, deadline: { type: ['string', 'null'], format: 'date' } } },
      CloneAiPlanRequest: { type: 'object', additionalProperties: false, required: ['requestKey'], properties: { requestKey: { type: 'string', minLength: 8, maxLength: 128 } } },
      ConfirmAiPlanRequest: { type: 'object', additionalProperties: false, required: ['versionId', 'selectedItemIds', 'requestKey'], properties: { versionId: { type: 'string', format: 'uuid' }, selectedItemIds: { type: 'array', minItems: 1, maxItems: 20, uniqueItems: true, items: { type: 'string', format: 'uuid' } }, requestKey: { type: 'string', minLength: 8, maxLength: 128 } } },
      AiImportTaskMap: { type: 'object', required: ['itemId', 'taskId'], properties: { itemId: { type: 'string', format: 'uuid' }, taskId: { type: 'string', format: 'uuid' } } },
      AiImportReceipt: { type: 'object', required: ['planId', 'versionId', 'requestKey', 'createdCount', 'checklistItemCount', 'dependencyCount', 'itemTaskMap', 'importedAt'], properties: { planId: { type: 'string', format: 'uuid' }, versionId: { type: 'string', format: 'uuid' }, requestKey: { type: 'string' }, createdCount: { type: 'integer' }, checklistItemCount: { type: 'integer' }, dependencyCount: { type: 'integer' }, itemTaskMap: { type: 'array', items: ref('AiImportTaskMap') }, importedAt: { type: 'string', format: 'date-time' } } },
      AiImportReceiptResponse: { type: 'object', required: ['data'], properties: { data: ref('AiImportReceipt') } },
      AiPlanClone: { type: 'object', required: ['planId', 'activeVersionId', 'status'], properties: { planId: { type: 'string', format: 'uuid' }, activeVersionId: { type: ['string', 'null'], format: 'uuid' }, status: { type: 'string', enum: ['DRAFT', 'IMPORTED', 'EXPIRED'] } } },
      AiPlanCloneResponse: { type: 'object', required: ['data'], properties: { data: ref('AiPlanClone') } },
      AiPlanActivationResponse: { type: 'object', required: ['data'], properties: { data: { type: 'object', required: ['planId', 'activeVersionId', 'source'], properties: { planId: { type: 'string', format: 'uuid' }, activeVersionId: { type: 'string', format: 'uuid' }, source: { type: 'string', enum: ['GENERATED', 'EDITED', 'REGENERATED', 'ADJUSTED'] } } } } },
      AiPlanVersion: { type: 'object', required: ['id', 'ordinal', 'source', 'draft', 'fieldLocks', 'contentHash', 'createdAt'], properties: { id: { type: 'string', format: 'uuid' }, ordinal: { type: 'integer' }, parentVersionId: { type: ['string', 'null'], format: 'uuid' }, baseVersionId: { type: ['string', 'null'], format: 'uuid' }, source: { type: 'string', enum: ['GENERATED', 'EDITED', 'REGENERATED', 'ADJUSTED'] }, schemaVersion: { type: 'integer' }, draft: ref('PlanDraftContent'), fieldLocks: { type: 'array', items: ref('PlannerFieldLock') }, contentHash: { type: 'string', pattern: '^[0-9a-f]{64}$' }, active: { type: 'boolean' }, purged: { type: 'boolean' }, createdAt: { type: 'string', format: 'date-time' } } },
      AiPlanVersionResponse: { type: 'object', required: ['data'], properties: { data: ref('AiPlanVersion') } },
      AiPlanVersionListResponse: { type: 'object', required: ['data', 'meta'], properties: { data: { type: 'array', items: ref('AiPlanVersion') }, meta: ref('PageMeta') } },
      AiPlan: { type: 'object', required: ['id', 'workspaceId', 'teamId', 'status', 'activeVersionId', 'createdAt', 'expiresAt', 'latestJob', 'version', 'importReceipt'], properties: { id: { type: 'string', format: 'uuid' }, workspaceId: { type: 'string', format: 'uuid' }, teamId: { type: 'string', format: 'uuid' }, status: { type: 'string', enum: ['DRAFT', 'IMPORTED', 'EXPIRED'] }, activeVersionId: { type: ['string', 'null'], format: 'uuid' }, createdAt: { type: 'string', format: 'date-time' }, expiresAt: { type: 'string', format: 'date-time' }, latestJob: { type: ['object', 'null'] }, version: { anyOf: [ref('AiPlanVersion'), { type: 'null' }] }, importReceipt: { anyOf: [ref('AiImportReceipt'), { type: 'null' }] } } },
      AiPlanResponse: { type: 'object', required: ['data'], properties: { data: ref('AiPlan') } },
      AiPlanSummary: { type: 'object', required: ['id', 'status', 'activeVersionId', 'createdAt', 'updatedAt', 'expiresAt', 'latestJob'], properties: { id: { type: 'string', format: 'uuid' }, status: { type: 'string', enum: ['DRAFT', 'IMPORTED', 'EXPIRED'] }, activeVersionId: { type: ['string', 'null'], format: 'uuid' }, createdAt: { type: 'string', format: 'date-time' }, updatedAt: { type: 'string', format: 'date-time' }, expiresAt: { type: 'string', format: 'date-time' }, latestJob: { type: ['object', 'null'] } } },
      AiPlanListResponse: { type: 'object', required: ['data', 'meta', 'availability'], properties: { data: { type: 'array', items: ref('AiPlanSummary') }, meta: ref('PageMeta'), availability: ref('AiPlannerStatus') } },
    },
  },
} as const;
