# PRD traceability

Đối chiếu từng ID trong [Task Management System PRD](task-management-system-prd.md) và [AI Smart Task Planner PRD](ai-smart-task-planner-prd.md) với code hiện có. Trạng thái được rút ra từ việc đọc code và test trong repo; không suy ra từ tài liệu thiết kế. Đường dẫn tính từ gốc repo.

## Cách đọc

| Trạng thái | Ý nghĩa |
| --- | --- |
| Implemented | Có code và có test tự động hoặc kiểm tra local chứng minh hành vi. |
| Implemented, unverified in browser | Có code (và thường có test API hoặc unit test web), nhưng hành vi trên giao diện chưa được chạy trong trình duyệt. |
| Implemented, unverified on GitHub | Cấu hình đã viết, nhưng chưa chạy trên GitHub Actions. |
| Not implemented | Chưa làm, hoặc cần môi trường thật mà chưa có bằng chứng. |
| Deviation | Có làm nhưng khác hoặc thiếu so với yêu cầu; chi tiết ở cột bằng chứng. |

Đã chạy local: typecheck, ESLint, 109 unit test web, production build, build và khởi động image web, build image API, smoke API qua proxy dev. Chưa chạy: mọi kiểm tra trong trình duyệt (kể cả hai trình duyệt), mobile / bàn phím / reduced motion / Lighthouse, một lần sinh kế hoạch thật bằng Gemini (người dùng tự chạy bằng key của mình), workflow trên GitHub, đẩy image lên Docker Hub, deploy Dokploy, rule Cloudflare Tunnel, SSE qua tunnel.

## Yêu cầu tổng thể (A1 đến RT1)

| ID | Trạng thái | Bằng chứng |
| --- | --- | --- |
| A1 | Implemented, unverified in browser | API: `apps/api/tests/integration/auth.test.ts` (register, login, logout thu hồi session). Web: `apps/web/src/features/auth/login-form.tsx`, `apps/web/src/features/auth/register-form.tsx`, `apps/web/src/components/nav-user.tsx`, `apps/web/src/features/auth/auth-provider.test.tsx`. |
| A2 | Implemented | `apps/api/src/shared/security/password.ts` (Argon2id); `apps/api/tests/integration/auth.test.ts` kiểm tra chỉ lưu hash dạng `$argon2id$`, response và log không chứa hash hay token. |
| A3 | Implemented, unverified in browser | API: `apps/api/tests/integration/workspace-task-boundaries.test.ts`, `apps/api/tests/integration/workspace-team.test.ts`, `apps/api/tests/integration/task-permissions.test.ts`. Web: `apps/web/src/features/workspaces/workspace-gate.tsx`, `apps/web/src/features/teams/team-gate.tsx`. |
| W1 | Implemented, unverified in browser | `apps/web/src/features/workspaces/workspaces-page.tsx`, `create-workspace-dialog.tsx`, `rename-form.tsx` (cùng thư mục); API: `apps/api/tests/integration/workspace-team.test.ts`. |
| W2 | Implemented, unverified in browser | `apps/web/src/features/teams/team-dialog.tsx`, `apps/web/src/features/teams/teams-table.tsx`, `apps/web/src/features/workspaces/settings-page.tsx`; API: `apps/api/tests/integration/workspace-team.test.ts`. |
| W3 | Implemented, unverified in browser | `apps/web/src/features/workspaces/members-table.tsx`, `add-member-dialog.tsx`, `role-select.tsx`, `apps/web/src/features/teams/team-members-sheet.tsx`, ma trận quyền `apps/web/src/features/workspaces/permissions.ts` (+ `permissions.test.ts`); API: `apps/api/tests/integration/permission-races.test.ts`, `apps/api/tests/integration/task-permissions.test.ts`. |
| W4 | Implemented, unverified in browser | `apps/web/src/features/tasks/assignee-select.tsx`, `apps/web/src/features/tasks/task-dialog.tsx`; DB và API: `apps/api/tests/integration/database-constraints.test.ts`. |
| T1 | Implemented, unverified in browser | `apps/web/src/features/tasks/task-dialog.tsx`, `delete-task-dialog.tsx`, `team-tasks-page.tsx` (cùng thư mục); API: `apps/api/tests/integration/task-permissions.test.ts`. |
| T2 | Implemented | Enum và default ở `apps/api/prisma/schema.prisma`; kiểm tra ở `apps/api/tests/integration/task-query.test.ts`; nhãn trạng thái `apps/web/src/features/tasks/task-badges.tsx`. |
| L1 | Implemented, unverified in browser | Search debounce 300 ms ở `apps/web/src/features/tasks/task-filters.tsx`; query URL `apps/web/src/features/tasks/task-query.ts` (+ `task-query.test.ts`); API: `apps/api/tests/integration/task-query.test.ts` (không phân biệt hoa thường, `%` và `_` là ký tự thường). |
| L2 | Implemented, unverified in browser | `apps/web/src/features/tasks/task-filters.tsx`; API: `apps/api/tests/integration/task-query.test.ts` (kết hợp AND). |
| L3 | Implemented, unverified in browser | Danh sách `apps/web/src/lib/use-paged-list.ts` (+ test), `apps/web/src/features/tasks/task-table.tsx`; board mỗi cột có tổng và "Load more": `apps/web/src/features/tasks/board/board-column.tsx`, `use-board-columns.ts`. |
| D1 | Implemented, unverified in browser | `apps/web/src/features/dashboard/dashboard-cards.tsx`; API: `apps/api/tests/integration/task-query.test.ts` (đếm trong một snapshot theo phạm vi role). |
| D2 | Implemented, unverified in browser | `apps/web/src/features/dashboard/upcoming-list.tsx`; API: `apps/api/tests/integration/task-query.test.ts` (cửa sổ hôm nay đến +6 ngày, loại DONE). |
| B1 | Implemented, unverified in browser | `apps/web/src/components/ui/kanban.tsx` (sensor chuột, cảm ứng, bàn phím), `apps/web/src/features/tasks/board/task-board.tsx`, `status-menu.tsx`, logic optimistic và rollback `use-status-move.ts` (+ `use-status-move.test.ts`). Chưa kéo thả thử trong trình duyệt. |
| B2 | Deviation | `docker-compose.dev.yml` chỉ có db, migrate, api; web chạy riêng bằng `npm run dev:web`. `docker-compose.prod.yml` có thêm service `web` nhưng chưa chạy cả stack bằng Compose. Backend: db, migrate, api khởi động đúng thứ tự (đã kiểm tra local trước đó). |
| B3 | Implemented | API: `apps/api/tests/unit/`, `apps/api/tests/integration/` (PostgreSQL thật, fake Gemini: `apps/api/tests/fakes/fake-gemini.ts`). Web: 12 file test cạnh code, ví dụ `apps/web/src/lib/api-client.test.ts`, `apps/web/src/lib/use-resource.test.tsx`. |
| B4 | Implemented | `apps/api/src/modules/openapi/openapi.ts`, `apps/api/tests/unit/openapi.test.ts`; Swagger UI tại `/api/docs`. |
| B5 | Implemented, unverified on GitHub | `.github/workflows/backend-ci.yml`, `.github/workflows/web-ci.yml` (audit, lint, typecheck, test, build). Chưa có run nào trên GitHub. |
| B6 | Not implemented | Chưa có URL HTTPS chạy được: `docker-compose.prod.yml`, `.github/workflows/web-release.yml`, `.github/workflows/backend-release.yml` đã sẵn sàng nhưng chưa đẩy image, chưa deploy, chưa cấu hình rule tunnel. Dữ liệu còn sau restart chưa kiểm tra trên môi trường thật. |
| H1 | Implemented | `apps/api/prisma/migrations/` (9 migration), `apps/api/prisma/seed.ts`, `apps/api/tests/integration/backend-restore-and-seed.test.ts`, `apps/api/tests/integration/database-constraints.test.ts`. |
| H2 | Not implemented | Có: `README.md`, `.env.example`, `apps/api/README.md`, OpenAPI, danh sách trạng thái trong [SRS](../../SRS.md). Thiếu: PR vào repo gốc, video demo hoặc buổi demo trực tiếp. |
| AI1 | Deviation | Đạt phần lớn AC-01 đến AC-10 và AI-A1 đến AI-A9 ở mức code; ba điểm lệch ở AI-A2, AI-A5, AI-A8 (bảng dưới). Chưa có lần sinh thật bằng Gemini. Chưa confirm thì không tạo task: `apps/api/tests/integration/ai-version-confirm.test.ts`. |
| AI2 | Implemented, unverified in browser | API: `apps/api/tests/integration/ai-credentials.test.ts`, `apps/api/tests/unit/credential-crypto.test.ts`. Web: `apps/web/src/features/ai-settings/gemini-key-form.tsx` (key nhập một lần, không hiển thị lại), `apps/web/src/features/ai-settings/ai-settings-page.tsx`. Chưa thử với key Gemini thật. |
| RT1 | Implemented, unverified in browser | API: `apps/api/tests/integration/realtime-sse.test.ts`, `apps/api/tests/integration/realtime-outbox.test.ts`. Web: `apps/web/src/lib/realtime/realtime-provider.tsx` (một EventSource mỗi tab), `apps/web/src/lib/realtime/invalidation-bus.ts`. Chưa kiểm tra hai trình duyệt. |

## AI Planner: AC-01 đến AC-10

Mọi dòng dưới đây cần một lần sinh thật bằng Gemini và kiểm tra trong trình duyệt mới coi là nghiệm thu; chất lượng nội dung do mô hình quyết định nên không thể chứng minh bằng test với fake provider.

| ID | Trạng thái | Bằng chứng |
| --- | --- | --- |
| AC-01 | Implemented, unverified in browser | `apps/web/src/features/ai-planner/goal-form.tsx`; API: `apps/api/tests/integration/ai-job-lifecycle.test.ts`. Draft không tạo task thật. |
| AC-02 | Implemented, unverified in browser | `apps/web/src/features/ai-planner/job-progress.tsx` hiển thị stage theo dữ liệu job; API: `apps/api/tests/integration/ai-job-lifecycle.test.ts`. |
| AC-03 | Implemented, unverified in browser | `apps/web/src/features/ai-planner/draft-view.tsx`, `draft-item-dialog.tsx`, `confirm-bar.tsx` (số task chọn); `draft-utils.test.ts`. |
| AC-04 | Implemented, unverified in browser | Chỉ `handleConfirm` trong `apps/web/src/features/ai-planner/plan-page.tsx` ghi task; API: `apps/api/tests/integration/ai-version-confirm.test.ts`. |
| AC-05 | Implemented, unverified in browser | `plan-page.tsx` báo số task tạo thực tế và có link tới task của team; API: `apps/api/tests/integration/ai-version-confirm.test.ts` (không import một phần, có receipt). |
| AC-06 | Implemented, unverified in browser | Trạng thái `confirming` khóa trang (`apps/web/src/features/ai-planner/planner-reducer.ts` + `planner-reducer.test.ts`), request key idempotent (`ai-plans-api.ts`); API: `apps/api/tests/integration/ai-version-confirm.test.ts` (replay receipt không tạo trùng). |
| AC-07 | Implemented, unverified in browser | `plan-page.tsx` (thẻ lỗi với "Try again" và "Start a new plan"), `planner-errors.ts`; `goal-form.tsx` tìm lại job theo request key khi mất phản hồi. |
| AC-08 | Implemented, unverified in browser | Ràng buộc nằm ở prompt và kiểm tra phía API: `apps/api/src/modules/planner/gemini.adapter.ts`, `apps/api/tests/unit/planner-analysis.test.ts`. Phía web chỉ hiển thị mốc tương đối và cảnh báo; cần sinh thật để xác nhận. |
| AC-09 | Implemented, unverified in browser | `apps/web/src/features/ai-planner/dependency-editor.tsx`, `confirm-bar.tsx` (chặn xác nhận khi task chọn phụ thuộc task không chọn); API: `apps/api/tests/integration/task-dependency-graph.test.ts`. |
| AC-10 | Implemented, unverified in browser | `apps/web/src/features/ai-planner/draft-task-item.tsx` hiển thị mô tả và "Done when"; chất lượng nội dung phụ thuộc mô hình. |

## AI Planner nâng cao: AI-A1 đến AI-A9

| ID | Trạng thái | Bằng chứng |
| --- | --- | --- |
| AI-A1 | Implemented, unverified in browser | Timeline theo stage thật: `apps/web/src/features/ai-planner/job-progress.tsx`; API: `apps/api/tests/integration/ai-job-lifecycle.test.ts`. |
| AI-A2 | Deviation | API nhận `memberProfiles` (role, capacity mỗi ngày, ngày làm việc) và trả cảnh báo; web hiển thị `draft.warnings` (`apps/web/src/features/ai-planner/draft-view.tsx`) nhưng form mục tiêu (`goal-form.tsx`) không có chỗ nhập capacity hay role, nên cảnh báo quá tải dựa trên dữ liệu không do người dùng khai báo. |
| AI-A3 | Implemented, unverified in browser | Opt-in thành viên ở `goal-form.tsx` (gộp toàn bộ thành viên team, không chọn từng người), gán assignee trong `draft-item-dialog.tsx`; API revalidate khi import. |
| AI-A4 | Implemented, unverified in browser | `apps/web/src/features/ai-planner/dependency-editor.tsx`, `draft-utils.ts` (+ test), `confirm-bar.tsx`; API: `apps/api/tests/integration/task-dependency-graph.test.ts`. Phụ thuộc giữa task thật sửa được ở `apps/web/src/features/tasks/task-dependencies.tsx`. |
| AI-A5 | Deviation | Có: Regenerate, Simplify, Add detail cho cả kế hoạch (`apps/web/src/features/ai-planner/revise-menu.tsx`) và khóa field sửa tay (`draft-utils.ts`, hàm `locksAfterEdit`). Thiếu: chọn một task hoặc một field để AI làm lại. API hỗ trợ `itemIds` và `fieldMask` (`apps/web/src/lib/api-types.ts`) nhưng UI chưa dùng; API test: `apps/api/tests/integration/ai-version-confirm.test.ts`. |
| AI-A6 | Implemented, unverified in browser | Ba chiến lược Fastest delivery, Balanced, Quality first trong `goal-form.tsx`. |
| AI-A7 | Implemented, unverified in browser | Checkbox "Existing tasks of this team" trong `goal-form.tsx` (mặc định tắt); API: `apps/api/tests/integration/ai-version-confirm.test.ts` (từ chối confirm khi task ngữ cảnh đổi sau khi sinh). UI gửi toàn bộ task team, không chọn từng task. |
| AI-A8 | Deviation | Có: danh sách version bất biến, xem chi tiết chỉ đọc, chấp nhận bản AI revise đang chờ (chỉ khi nó dựa trên draft đang active; version cũ khác chỉ đọc) (`apps/web/src/features/ai-planner/versions-sheet.tsx`). Thiếu: so sánh hai version theo field. |
| AI-A9 | Implemented, unverified in browser | "Fit a new deadline" trong `revise-menu.tsx` gọi `ADJUST_DEADLINE`; API: `apps/api/tests/integration/ai-version-confirm.test.ts` (chỉ đổi schedule, chờ review). |

## Realtime: RT-01 đến RT-08

| ID | Trạng thái | Bằng chứng |
| --- | --- | --- |
| RT-01 | Implemented, unverified in browser | Sự kiện chỉ kích hoạt refetch: `apps/web/src/lib/realtime/invalidation-bus.ts`, `apps/web/src/lib/use-resource.ts`; API: `apps/api/tests/integration/realtime-sse.test.ts`. Chưa thử hai trình duyệt. |
| RT-02 | Implemented, unverified in browser | Sự kiện `planner.job_changed` làm tải lại plan (`apps/web/src/lib/realtime/event-types.ts`); không có timer polling (`apps/web/src/components/query-provider.tsx` tắt refetch theo thời gian, focus và reconnect). |
| RT-03 | Implemented | `apps/api/tests/integration/realtime-outbox.test.ts`. |
| RT-04 | Implemented, unverified in browser | API: `apps/api/tests/integration/realtime-sse.test.ts` (replay sau khi mất listener). Web: mở lại stream với backoff trong `apps/web/src/lib/realtime/realtime-provider.tsx`. |
| RT-05 | Implemented, unverified in browser | API: `apps/api/tests/integration/realtime-sse.test.ts` (đóng stream khi thu hồi team membership hoặc logout). Web: xử lý `access.changed` và `auth.revoked` trong `apps/web/src/lib/realtime/event-types.ts`. |
| RT-06 | Implemented, unverified in browser | API: `apps/api/tests/integration/realtime-sse.test.ts` (cursor lạ hoặc hết hạn thì `resync_required`), `apps/api/tests/integration/backend-restore-and-seed.test.ts` (epoch sau restore). Web: bỏ cursor và tải lại một lần ở `realtime-provider.tsx`. |
| RT-07 | Not implemented | Cần chạy qua tunnel công khai: chưa có rule tunnel, chưa deploy, chưa thử trong trình duyệt. Yêu cầu còn nhắc Traefik; cách triển khai hiện tại dùng Cloudflare Tunnel (xem [runbook](../03-operations/backend-operations-runbook.md#web-and-cloudflare-tunnel)). API đã gửi `X-Accel-Buffering: no` và heartbeat 15 giây. |
| RT-08 | Deviation | Có: di chuyển status optimistic được đối chiếu khi dữ liệu mới về (`apps/web/src/features/tasks/board/use-status-move.ts` + test); form tách state riêng nên refetch không ghi đè dữ liệu đang sửa. Thiếu: không có làm mới khi qua ngày mới hoặc khi quay lại tab (theo quyết định không refetch theo focus), nên "hôm nay" trong nhãn quá hạn có thể cũ cho tới lần tải kế tiếp. |

## Các điểm lệch cần ghi nhận

| Điểm | Chi tiết |
| --- | --- |
| Duplicate plan | Nhân bản plan (`clonePlan` trong `apps/web/src/features/ai-planner/ai-plans-api.ts`, dialog xác nhận ở `plan-page.tsx`) luôn tạo bản sao trong cùng team vì endpoint clone của API không nhận team đích. Không thể nhân bản sang team khác. |
| Capacity thành viên | Xem AI-A2: UI không thu thập capacity, role hay ngày làm việc. |
| AI revise theo phần | Xem AI-A5: chỉ revise cả kế hoạch. |
| So sánh version | Xem AI-A8: không có diff theo field. |
| Compose đầy đủ | Xem B2: dev Compose không có web. |
| Qua ngày / quay lại tab | Xem RT-08. |
