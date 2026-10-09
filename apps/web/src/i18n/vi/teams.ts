import type { teams as source } from '../en/teams';

export const teams: typeof source = {
  dialog: {
    renameTitle: 'Đổi tên nhóm',
    renameDescription: 'Tên mới hiển thị với mọi người nhìn thấy nhóm này.',
    createDescription: 'Nhóm là nơi chứa công việc. Bạn vào nhóm mới ngay và có thể thêm người khác từ menu của nhóm ở sidebar.',
    renamed: 'Đã đổi tên nhóm',
    created: 'Đã tạo nhóm',
  },
  gate: {
    unavailableTitle: 'Nhóm này không khả dụng',
    unavailableMessage: 'Nhóm có thể đã bị xóa, hoặc bạn không còn là thành viên.',
    back: 'Về trang tổng quan',
    loading: 'Đang tải nhóm',
  },
  members: {
    titleFor: (team) => `Thành viên nhóm ${team}`,
    title: 'Thành viên nhóm',
    description: 'Chỉ người trong nhóm mới được giao công việc của nhóm.',
    added: (person, team) => `Đã thêm ${person} vào ${team}`,
    alreadyIn: 'Người này đã ở trong nhóm.',
    removed: (person, team) => `Đã gỡ ${person} khỏi ${team}`,
    addLabel: 'Thành viên workspace cần thêm',
    loadingPeople: 'Đang tải danh sách…',
    everyoneIn: 'Mọi người đều đã ở trong nhóm',
    select: 'Chọn một thành viên workspace',
    loadMorePeople: 'Tải thêm thành viên workspace',
    empty: 'Nhóm chưa có ai. Hãy thêm một thành viên workspace ở trên.',
    removeFrom: (person) => `Gỡ ${person} khỏi nhóm`,
  },
  table: {
    empty: 'Chưa có nhóm nào. Tạo nhóm để bắt đầu thêm công việc.',
    team: 'Nhóm',
    of: (team) => `của ${team}`,
    newTeam: 'Nhóm mới',
  },
};
