import type { dashboard as source } from '../en/dashboard';

export const dashboard: typeof source = {
  total: 'Tổng số công việc',
  allTeams: (workspace) => `Tất cả nhóm trong ${workspace}.`,
  yourTeams: (workspace) => `Các nhóm của bạn trong ${workspace}.`,
  noTeams: 'Chưa có nhóm nào để hiển thị. Công việc sẽ xuất hiện ở đây khi bạn vào một nhóm.',
  noTasks: 'Chưa có công việc nào. Mở một nhóm và tạo công việc đầu tiên.',
  upcoming: 'Hạn sắp tới',
  nothingDue: 'Không có công việc nào đến hạn trong giai đoạn này.',
  team: 'Nhóm',
};
