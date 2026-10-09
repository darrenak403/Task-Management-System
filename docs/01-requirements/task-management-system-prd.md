# Task Management System — Product Requirements Document

## Thông tin tài liệu

| Thuộc tính | Giá trị |
| --- | --- |
| Loại | Product Requirements Document (PRD) tổng thể |
| Phiên bản | 1.0 — baseline trước khi code |
| Ngày chốt scope | 2026-10-09 |
| Trạng thái | Yêu cầu đã thống nhất; chưa có implementation evidence |
| Nguồn đề bài | [README pre-test ở repo root](../../README.md) |
| Đặc tả phân hệ AI | [AI Smart Task Planner PRD](ai-smart-task-planner-prd.md) |

## 1. Mục tiêu sản phẩm

Xây dựng ứng dụng quản lý công việc cho nhóm nhỏ theo mô hình **workspace → team → task**. Thành viên phối hợp trên task chung, theo dõi tiến độ qua board/list/dashboard và nhận cập nhật realtime. AI Smart Task Planner hỗ trợ lập kế hoạch trong phạm vi team; người dùng xem và xác nhận bản nháp trước khi tạo task thật.

Sản phẩm phục vụ bài pre-test tuyển dụng Fullstack. Phạm vi gồm MVP của đề bài, đủ sáu mục cộng điểm, workspace/team và toàn bộ AI Planner MVP cùng khả năng nâng cao đã được yêu cầu.

## 2. Nguồn yêu cầu và thứ tự ưu tiên

1. README ở repo root là đề bài pre-test gốc; giữ nguyên nội dung.
2. PRD này hợp nhất phạm vi và tiêu chí nghiệm thu cho toàn sản phẩm, gồm các quyết định mở rộng đã được chủ repo chốt.
3. AI Planner PRD là đặc tả sản phẩm chi tiết của phân hệ AI, được sao chép nguyên văn từ nguồn cung cấp. Tài liệu này không thay cho yêu cầu toàn hệ thống.
4. Architecture documents mô tả cách đáp ứng yêu cầu; chúng không tự ý thu hẹp phạm vi PRD.

Khi cần diễn giải đề bài gốc: task được chia sẻ theo quyền team/workspace; toàn bộ sáu mục cộng điểm và AI nâng cao đều phải hoàn thành; realtime không polling. Không sửa README gốc hoặc bản sao AI PRD để phản ánh diễn giải này.

## 3. Người dùng và mô hình chia sẻ

- **OWNER** tạo workspace, quản lý workspace/team, thành viên và quyền; có quyền trên mọi team trong workspace.
- **ADMIN** quản lý team và task trong workspace; không cấp hoặc thu hồi quyền ADMIN.
- **MEMBER** xem, tạo và sửa task của team mình; chỉ xóa task do mình tạo trong team còn tham gia.
- Một người có thể thuộc nhiều workspace và team. Mỗi task thuộc đúng một team. Assignee phải là thành viên hiện tại của team.
- AI plan và history là riêng tư với người tạo; phải xác nhận trước khi draft thành task thật.

Chi tiết role, revoke membership, validation và concurrency nằm trong System Architecture.

## 4. Phạm vi chức năng

### 4.1 Tài khoản và quyền truy cập

- Đăng ký, đăng nhập, đăng xuất và quản lý phiên phía server.
- Người dùng chỉ đọc/ghi dữ liệu trong workspace/team được cấp quyền.
- Thêm thành viên đã đăng ký; không tự tạo tài khoản khi thêm vào workspace.

### 4.2 Workspace, team và thành viên

- Tạo, chọn và sửa tên workspace/team.
- Quản lý workspace membership và team membership theo OWNER/ADMIN/MEMBER.
- Thêm thành viên, thu hồi quyền và giữ task/lịch sử khi thành viên rời nhóm.
- Tạo, xem, sửa, xóa task trong team được phép; giao task cho member hợp lệ.

### 4.3 Task, tìm kiếm và dashboard

- CRUD task gồm title, description, status, priority, deadline, creator và assignee.
- Trạng thái TODO, IN_PROGRESS, DONE; Kanban kéo thả chỉ đổi status.
- Search theo title; filter status/priority; phân trang list và từng cột Kanban.
- Dashboard hiển thị tổng task, số lượng theo status và task sắp đến hạn trong phạm vi được phép.

### 4.4 Sáu mục cộng điểm bắt buộc

Hoàn thành Docker Compose, unit/integration tests, Swagger/OpenAPI, CI chạy kiểm tra khi push, deploy demo và Kanban kéo thả. Đây là phạm vi đã chốt, không còn là tùy chọn.

### 4.5 AI Smart Task Planner

- Tạo kế hoạch có cấu trúc từ mục tiêu; lưu job/progress có thể phục hồi; hiển thị stages phản ánh công việc thực.
- Review, sửa và chọn task/checklist/criteria/estimate/schedule/dependency; chỉ tạo task sau xác nhận tường minh.
- Hoàn thành AI MVP và AI-A1–AI-A9: strategies, capacity/overload, context có opt-in, phân công người thật, DAG, targeted edits, version/history/diff và điều chỉnh deadline.
- Chỉ dùng Gemini làm provider AI: mỗi tài khoản tự cấu hình tối đa một Gemini API key và nhập model muốn dùng; không có key provider khác hoặc key Gemini dùng chung toàn hệ thống. Tài khoản có thể thay hoặc xóa key; job chỉ dùng key của người tạo. Key không chia sẻ theo workspace, kể cả OWNER/ADMIN không được đọc key thành viên khác. Key được gửi trực tiếp tới backend qua HTTPS để mã hóa/lưu và gọi provider; không được trả lại, lưu ở browser, log hoặc đưa vào prompt/context/job/realtime payload. Secret mã hóa server-side là hạ tầng bảo vệ dữ liệu, không phải provider key và không nhập trên giao diện.
- Báo rõ trước khi dùng AI: Gemini áp quota theo project và tính billing vào billing account liên kết với project của key. Người dùng cần cung cấp key từ project họ có quyền sử dụng và chịu trách nhiệm với billing account đó; giới hạn ứng dụng không bảo đảm chặn cứng hóa đơn provider. Subtask là checklist bên trong task.
- Yêu cầu chi tiết nằm trong [AI Planner PRD](ai-smart-task-planner-prd.md); thiết kế/kiểm chứng nằm trong [AI + Realtime Technical Design](../02-architecture/ai-and-realtime-technical-design.md).

### 4.6 Realtime

- Đẩy thay đổi task, dashboard, membership/quyền và AI job/version/import đến client liên quan.
- Cập nhật phải được server đẩy đến client; không polling hoặc fallback polling. Khi mất kết nối, client nhận lại events bị lỡ hoặc tải snapshot một lần khi cần. Cơ chế truyền tải được chốt trong Realtime Architecture.
- Thu hồi private data khi quyền bị revoke; không ghi đè nội dung người dùng đang sửa trong form.
- Tiêu chí kỹ thuật RT-01–RT-08 nằm trong [AI + Realtime Technical Design](../02-architecture/ai-and-realtime-technical-design.md#1510-nghiệm-thu-và-cập-nhật-kế-hoạch).

## 5. Ranh giới và điều không thuộc scope

Không triển khai email invitation, chat, task calendar view riêng, upload file, notification center, OAuth hoặc quên mật khẩu. Calendar trong form chỉ chọn deadline. Project trong AI spec được ánh xạ thành team, không thêm entity Project.

Không hỗ trợ chuyển OWNER, xóa workspace/team, chuyển task giữa team, tự rời team hoặc soft-delete/restore task. AI không tự tạo task, không import task một phần và không thực hiện hành động ngoài planner.

## 6. Ràng buộc sản phẩm và bàn giao

- Fullstack dùng Node.js/TypeScript; frontend Next.js; backend Express riêng; PostgreSQL/Prisma.
- FE dùng shadcn/ui, React Bits và Tailwind CSS.
- Pipeline: GitHub Actions → Docker Hub → Dokploy → VPS.
- Bàn giao gồm hướng dẫn chạy, .env.example không có secret, migration/seed, API docs, trạng thái chức năng, PR và demo/video 3–5 phút theo đề bài.
- Thời gian ban đầu là hai ngày. Không tự giảm scope đã chốt; nếu thiếu thời gian, ghi phần chưa đạt và trao đổi hạn bàn giao.

## 7. Yêu cầu và tiêu chí nghiệm thu tổng thể

| ID | Yêu cầu | Tiêu chí nghiệm thu cấp sản phẩm |
| --- | --- | --- |
| A1 | Đăng ký, đăng nhập, đăng xuất | Tài khoản hoạt động; logout vô hiệu session hiện tại. |
| A2 | Bảo vệ mật khẩu | Chỉ lưu password hash; credential không xuất hiện trong response/log. |
| A3 | Cô lập dữ liệu | Workspace/team ngoài quyền không đọc/ghi được qua UI hoặc API. |
| W1 | Workspace | Tạo, chọn và đổi tên workspace theo role. |
| W2 | Team | Tạo, chọn và đổi tên team trong workspace đúng quyền. |
| W3 | Membership/role | Thêm, xem, đổi role hoặc gỡ member theo ma trận quyền; revoke có hiệu lực. |
| W4 | Assignee | Gán hoặc bỏ assignee; người được gán thuộc team hiện tại. |
| T1 | Task CRUD | Tạo/xem/sửa/xóa task trong team; dữ liệu còn sau reload. |
| T2 | Trạng thái | Chỉ nhận TODO/IN_PROGRESS/DONE và áp dụng default đã định. |
| L1 | Search | Tìm theo title không phân biệt hoa thường. |
| L2 | Filter | Filter status/priority kết hợp với search theo AND. |
| L3 | Pagination | Tổng/trang chính xác; board phân trang theo từng cột. |
| D1 | Dashboard counts | Total bằng tổng ba status trong các team người dùng được xem. |
| D2 | Upcoming tasks | Đúng cửa sổ deadline đã định; loại task DONE. |
| B1 | Kanban | Kéo thả đổi status; lỗi mutation không làm UI lệch dữ liệu đã lưu. |
| B2 | Docker Compose | Checkout sạch khởi chạy DB, migration, API và web đúng thứ tự. |
| B3 | Tests | Unit/integration suite kiểm tra nghiệp vụ và quyền lõi. |
| B4 | OpenAPI | Contract mô tả endpoint, auth, payload và lỗi. |
| B5 | CI | Push chạy test, lint, typecheck và build. |
| B6 | Demo deploy | URL HTTPS chạy được; dữ liệu còn sau app restart. |
| H1 | Database setup | Migration tạo schema/FK/constraints; seed phục vụ demo. |
| H2 | Bàn giao | README/env/API/status/PR/video hoặc live demo đủ để reviewer kiểm tra. |
| AI1 | AI Planner toàn bộ MVP + nâng cao | Đạt AC-01–AC-10 và AI-A1–AI-A9; chưa confirm không tạo task. |
| AI2 | Gemini key/model theo tài khoản | Mỗi tài khoản thiết lập/thay/xóa đúng một Gemini key và chọn model; chỉ job của chủ key dùng được; không có provider khác/shared key và không lộ key qua API đọc, workspace role, log, browser storage hoặc dữ liệu AI/realtime. |
| RT1 | Realtime, không polling | Hai client nhận cập nhật đúng quyền; reconnect/revoke/resync đạt RT-01–RT-08. |

Core IDs A1–H2 gom yêu cầu đề bài, workspace/team đã xác nhận, sáu bonus và bàn giao; AI1/AI2/RT1 ghi riêng các mở rộng toàn sản phẩm. Giữ các ID này khi tách implementation plan và test cases.

## 8. Tiêu chí hoàn thành sản phẩm

- Mọi yêu cầu trong ma trận đạt hoặc được ghi rõ là chưa đạt; không suy ra hoàn thành từ tài liệu thiết kế.
- Reviewer có thể chạy ứng dụng theo hướng dẫn, kiểm tra API/CI và mở demo.
- Kiểm tra quyền giữa workspace/team, task workflow, AI review/confirm và cập nhật realtime.
- Bàn giao theo checklist trong System Architecture; giữ nguyên README pre-test gốc.
