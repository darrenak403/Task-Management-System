import type { nav as source } from '../en/nav';

export const nav: typeof source = {
  workspace: 'Workspace',
  workspaces: 'Workspace',
  dashboard: 'Tổng quan',
  myTasks: 'Việc của tôi',
  invitePeople: 'Mời thành viên',
  teams: 'Nhóm',
  createTeam: 'Tạo nhóm',
  teamsLoadFailed: 'Không tải được danh sách nhóm. Thử lại',
  createFirstTeam: 'Tạo nhóm đầu tiên',
  noTeams: 'Bạn chưa ở trong nhóm nào.',
  manageTeam: (team) => `Quản lý ${team}`,
  members: 'Thành viên',
  rename: 'Đổi tên',
  tasks: 'Công việc',
  aiPlanner: 'AI Planner',
  aiPlan: 'Kế hoạch AI',
  loadMoreTeams: 'Tải thêm nhóm',
  aiSettings: 'Cài đặt AI',
  settings: 'Cài đặt',
};
