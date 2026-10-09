# AIM — Task Management System: SRS và báo cáo bài làm

Tài liệu này mô tả bài làm theo đúng thứ tự yêu cầu trong [đề bài](../README.md). Đọc mục 1 là thử được hệ thống; các mục sau đối chiếu từng yêu cầu và nêu rõ phần chưa làm.

| | |
| --- | --- |
| Ứng dụng | https://task.darrenak.id.vn |
| Tài liệu API (Swagger UI) | https://task-api.darrenak.id.vn/api/docs |
| OpenAPI JSON | https://task-api.darrenak.id.vn/api/openapi.json |
| Vị trí ứng tuyển | Fullstack |
| Công nghệ | Next.js 16, React 19, Node.js 24, Express, PostgreSQL 17, Prisma, Docker |

## 1. Thử nhanh trong 5 phút

### Tài khoản

| Tài khoản | Workspace | Nội dung có sẵn |
| --- | --- | --- |
| `anh@gmail.com` | AIM Studio | Hai team Backend và Frontend, task ở cả ba trạng thái, có checklist và phụ thuộc giữa các task |
| `khanh@gmail.com` | Quán Cà Phê Sáng | Một team Vận hành |

Hai tài khoản demo dùng chung một mật khẩu, được gửi kèm trong mô tả Pull Request. Dữ liệu demo gồm 44 task, hạn hoàn thành tính theo ngày chạy seed nên luôn có task sắp đến hạn và task quá hạn.

Có thể tự đăng ký tài khoản mới tại `/register` (mật khẩu từ 8 ký tự). Tài khoản mới chưa có workspace nào và không thấy dữ liệu của người khác.

### Các bước thử

| # | Thao tác | Kết quả mong đợi | Yêu cầu |
| --- | --- | --- | --- |
| 1 | Đăng nhập bằng `anh@gmail.com` | Vào danh sách workspace, thấy AIM Studio | A.1 |
| 2 | Mở AIM Studio → Dashboard | Tổng số task, số task theo ba trạng thái, danh sách sắp đến hạn | A.4 |
| 3 | Mở team Backend → tab danh sách | Bảng task có phân trang | A.2, A.3 |
| 4 | Gõ vào ô tìm kiếm, chọn lọc trạng thái và mức ưu tiên | Danh sách thu hẹp theo cả ba điều kiện; điều kiện nằm trên URL | A.3 |
| 5 | Tạo một task, sửa, rồi xoá | Task xuất hiện, đổi, biến mất mà không tải lại trang | A.2 |
| 6 | Chuyển sang Kanban, kéo một thẻ sang cột khác | Thẻ đổi trạng thái ngay; dashboard đổi theo | B (Kanban) |
| 7 | Đăng xuất, đăng nhập bằng `khanh@gmail.com` | Chỉ thấy Quán Cà Phê Sáng, không thấy AIM Studio | A.1 |
| 8 | Dán URL một task của AIM Studio khi đang là `khanh` | Bị từ chối truy cập | A.1 |
| 9 | Mở Swagger UI | 49 operation, có thể gọi thử sau khi đăng nhập | B (OpenAPI) |

Giao diện có tiếng Anh và tiếng Việt (nút cờ ở góc trên), light và dark mode. Nội dung do người dùng nhập giữ nguyên ngôn ngữ đã gõ.

AI Planner cần Gemini API key riêng của người thử, xem mục 4.

## 2. Phạm vi và vai trò

Đề bài yêu cầu quản lý công việc cho cá nhân hoặc nhóm nhỏ. Bài làm tổ chức dữ liệu theo **workspace → team → task**: một người có thể làm việc một mình trong workspace riêng, hoặc mời người khác vào.

Vai trò gắn với từng workspace; không có tài khoản quản trị toàn hệ thống.

| Việc | Owner | Manager | Member |
| --- | --- | --- | --- |
| Xem và làm task trong team mình thuộc | Có | Có | Có |
| Xem và làm task của mọi team trong workspace | Có | Có | Không |
| Xoá task | Mọi task | Mọi task | Chỉ task mình tạo |
| Đổi tên workspace, tạo và đổi tên team | Có | Có | Không |
| Xem danh sách thành viên, thêm thành viên, xếp người vào team | Có | Có | Không |
| Xoá thành viên | Manager và Member | Chỉ Member | Không |
| Đổi vai trò người khác | Có | Không | Không |

Owner là người tạo workspace và không đổi được. "Manager" là tên hiển thị; giá trị trong API và database là `ADMIN`. Giao diện chỉ ẩn hoặc hiện nút theo bảng này, còn API kiểm tra lại quyền ở mọi request.

## 3. Đối chiếu yêu cầu đề bài

### A. Chức năng bắt buộc

| Yêu cầu | Trạng thái | Cách đáp ứng |
| --- | --- | --- |
| **1. Tài khoản**: đăng ký, đăng nhập, đăng xuất | Xong | Phiên lưu phía server, cookie `HttpOnly`, `SameSite=Lax`, `Secure` ở production. Đăng xuất thu hồi phiên. |
| Mật khẩu mã hoá an toàn | Xong | Băm bằng Argon2id; response và log không chứa hash hay token. |
| Chỉ truy cập dữ liệu của mình | Xong | Mọi truy vấn giới hạn theo workspace và team của người gọi; có test tích hợp cho từng ranh giới. |
| **2. Task CRUD**: tạo, xem, sửa, xoá | Xong | Danh sách, Kanban và hộp thoại task. |
| Tiêu đề, mô tả, trạng thái, ưu tiên, hạn hoàn thành | Xong | Thêm: người được giao, ngày bắt đầu, ước lượng thời gian, tiêu chí hoàn thành, checklist, task phụ thuộc. |
| Trạng thái `TODO`, `IN_PROGRESS`, `DONE` | Xong | Enum trong database. Mức ưu tiên: `LOW`, `MEDIUM`, `HIGH`. |
| **3. Tìm kiếm** theo tiêu đề | Xong | Không phân biệt hoa thường, chờ 300 ms sau khi ngừng gõ. |
| Lọc theo trạng thái và ưu tiên | Xong | Kết hợp được với tìm kiếm. |
| Phân trang | Xong | Danh sách chia trang; mỗi cột Kanban có tổng số và nút tải thêm. |
| **4. Dashboard**: tổng số task | Xong | Theo phạm vi vai trò của người xem. |
| Số task hoàn thành, đang làm, chưa bắt đầu | Xong | Đếm trong cùng một lần đọc nên các số luôn khớp tổng. |
| Danh sách sắp đến hạn | Xong | Task chưa `DONE` có hạn từ hôm nay đến 6 ngày tới. Có thêm trang My Tasks. |

### B. Chức năng cộng điểm

| Yêu cầu | Trạng thái | Cách đáp ứng |
| --- | --- | --- |
| Kanban kéo thả | Xong | Dùng được bằng chuột, cảm ứng và bàn phím. Thẻ chuyển ngay, tự hoàn lại nếu server từ chối. |
| Docker Compose | Xong, có lưu ý | `docker-compose.prod.yml` chạy cả bốn dịch vụ (database, migration, API, web) và đang chạy bản demo. `docker-compose.dev.yml` chỉ có database, migration và API; web chạy bằng dev server. |
| Unit test, integration test | Xong | API: 133 test, phần lớn chạy trên PostgreSQL thật. Web: 113 unit test. |
| Swagger / OpenAPI | Xong | 49 operation; Swagger UI tại `/api/docs`. Kiểu dữ liệu phía web được sinh từ OpenAPI. |
| CI chạy test khi push | Xong | GitHub Actions `Backend CI` và `Web CI`: audit, lint, typecheck, test, build trên mỗi PR và push vào `dev`, `main`. |
| Deploy demo | Xong | CI xanh trên `main` thì đẩy image lên Docker Hub; deploy bằng Dokploy, truy cập qua Cloudflare Tunnel. |

### Mục 4 của đề bài: database

10 migration Prisma tạo bảng, khoá ngoại và ràng buộc (ví dụ: người được giao phải thuộc team của task, ước lượng tối thiểu không lớn hơn tối đa). Có test tích hợp cho các ràng buộc này.

## 4. Phần làm thêm ngoài đề bài

| Phần | Mô tả |
| --- | --- |
| Workspace, team, vai trò | Mục 2. |
| Cập nhật tức thời | Thay đổi của người khác tự hiện trên màn hình, không cần tải lại và không polling (Server-Sent Events). |
| AI Planner | Nhập một mục tiêu, AI hỏi lại nếu thiếu thông tin rồi đề xuất danh sách task kèm hạn, ước lượng và phụ thuộc. Người dùng sửa bản nháp và bấm xác nhận thì task mới được tạo. |
| Hai ngôn ngữ, dark mode | Tiếng Anh và tiếng Việt. |

### Thử AI Planner

1. Lấy một Gemini API key tại Google AI Studio.
2. Vào **AI settings**, dán key, chọn model `gemini-3.5-flash-lite`, bấm kiểm tra kết nối.
3. Vào một team → **AI Planner**, nhập mục tiêu, ví dụ: "Ra mắt trang đặt bàn online cho quán trong 2 tuần".
4. Trả lời câu hỏi làm rõ (nếu có), xem bản nháp, bấm xác nhận để tạo task.

Key được mã hoá phía server, chỉ nhập một lần và không hiển thị lại. Hệ thống không có key dùng chung.

## 5. Quy tắc nghiệp vụ

| Quy tắc | Giá trị |
| --- | --- |
| Mật khẩu | 8 đến 128 ký tự |
| Xoá task | Member chỉ xoá task mình tạo |
| Người được giao | Phải là thành viên của team chứa task |
| Phụ thuộc giữa task | Không được tạo vòng lặp |
| Sắp đến hạn | Hôm nay đến 6 ngày tới, theo giờ Việt Nam, không tính task `DONE` |
| Ai dùng AI Planner | Owner và Manager ở mọi team; Member ở team mình thuộc |
| Kế hoạch AI | Chỉ người tạo nhìn thấy; chưa xác nhận thì chưa có task nào được tạo |
| Giới hạn AI mỗi ngày | 10 lượt mỗi người, 30 mỗi workspace, 100 toàn hệ thống; tính theo ngày giờ Việt Nam |
| Giới hạn mỗi yêu cầu AI | Tối đa 4 lần gọi model, tính cả lần thử lại |

## 6. Chạy local

Cần Node.js 24.21.0, npm 11 và Docker.

```sh
cp .env.example .env        # đổi mật khẩu PostgreSQL mẫu; giữ APP_ORIGIN=http://localhost:3000
npm ci
npm run docker:dev:up       # PostgreSQL, migration và API tại http://127.0.0.1:4000
npm run dev:web             # web tại http://localhost:3000
```

Dữ liệu demo: đặt `SEED_DEMO_DATA=yes` và `SEED_DEMO_PASSWORD` (từ 8 ký tự) trong `.env`, rồi chạy `npm run docker:dev:seed`. Chạy lại nhiều lần vẫn an toàn.

| Lệnh | Tác dụng |
| --- | --- |
| `npm run lint` / `npm run typecheck` | ESLint và TypeScript cho cả hai app |
| `npm test` | Test của API (cần một PostgreSQL riêng cho test, xem [apps/api/README.md](../apps/api/README.md)) rồi test của web |
| `npm run docker:dev:down` | Dừng database và API, giữ dữ liệu |

Nếu có [Task](https://taskfile.dev/): `task dev` chạy cả stack, `task seed` tạo dữ liệu demo, `task reset` xoá database local rồi seed lại.

AI Planner ở local cần thêm keyring mã hoá và giới hạn token trong `.env`; cách đặt nằm trong [runbook](03-operations/backend-operations-runbook.md).

## 7. Kiến trúc tóm tắt

| Thành phần | Công nghệ |
| --- | --- |
| `apps/web` | Next.js 16 (App Router), React 19, Tailwind CSS 4, shadcn/ui, TanStack Query, dnd-kit |
| `apps/api` | Node.js 24, TypeScript, Express, Prisma, PostgreSQL 17 |
| Hạ tầng | Docker, GitHub Actions, Docker Hub, Dokploy, Cloudflare Tunnel |

Trình duyệt chỉ gọi `/api/*` trên cùng địa chỉ với web; web server chuyển tiếp sang API, nên cookie phiên luôn là first-party. Hostname `task-api` dành cho Swagger và health check.

Quy trình phát hành: nhánh tính năng → PR vào `dev` → PR vào `main` → CI → image lên Docker Hub → bấm deploy trên Dokploy. Migration chạy trước khi API khởi động.

## 8. Checklist bàn giao

| Hạng mục | Trạng thái | Ở đâu |
| --- | --- | --- |
| Pull Request vào repo gốc | Chưa | |
| Hướng dẫn cài đặt và chạy | Xong | Mục 6 và [apps/api/README.md](../apps/api/README.md). README ở gốc giữ nguyên đề bài. |
| `.env.example` không chứa secret thật | Xong | [.env.example](../.env.example) |
| Migration và dữ liệu mẫu | Xong | `apps/api/prisma/migrations`, `apps/api/prisma/seed.ts` |
| Tài liệu API | Xong | Swagger UI và OpenAPI JSON ở đầu tài liệu |
| Danh sách chức năng đã và chưa hoàn thành | Xong | Mục 3 và mục 9 |
| Video demo 3–5 phút hoặc demo trực tiếp | Chưa | |

## 9. Chưa hoàn thành và hạn chế

Chưa làm:

- Pull Request vào repo gốc và video demo.
- Đăng nhập bằng Google hoặc Facebook, quên mật khẩu: nút có hiển thị nhưng bị khoá.
- AI Planner: chưa cho AI làm lại riêng một task hay một trường (chỉ làm lại cả kế hoạch); chưa so sánh hai phiên bản kế hoạch; chưa có chỗ khai báo năng lực làm việc của từng thành viên; nhân bản kế hoạch chỉ tạo bản sao trong cùng team.
- Dev Compose chưa gồm web.

Hạn chế đã biết:

- Một số thông báo sinh từ server vẫn bằng tiếng Anh khi giao diện là tiếng Việt: cảnh báo trong kế hoạch AI, lỗi kiểm tra dữ liệu từng trường.
- Màn hình không tự làm mới khi sang ngày mới hoặc khi quay lại tab, nên danh sách "sắp đến hạn" có thể cũ cho tới lần thay đổi dữ liệu kế tiếp.

Chưa kiểm chứng:

- Cập nhật tức thời giữa hai trình duyệt trên bản demo công khai.
- Giao diện trên điện thoại, điều hướng chỉ bằng bàn phím, điểm Lighthouse.

## 10. Tài liệu chi tiết

| Tài liệu | Nội dung |
| --- | --- |
| [PRD](01-requirements/task-management-system-prd.md) | Yêu cầu đầy đủ và mã tiêu chí nghiệm thu |
| [PRD traceability](01-requirements/prd-traceability.md) | Từng tiêu chí ứng với file code và test nào |
| [System architecture](02-architecture/system-architecture.md) | Quyết định kiến trúc, mô hình dữ liệu, bảo mật |
| [AI + Realtime technical design](02-architecture/ai-and-realtime-technical-design.md) | Thiết kế AI Planner và cập nhật tức thời |
| [Operations runbook](03-operations/backend-operations-runbook.md) | Deploy, rollback, backup, restore |
