# Đề bài tuyển dụng Intern: Task Management System

Mini Project · Backend / Fullstack Developer · Thời gian: 2–3 ngày

## Quy trình làm bài 

Quy trình làm bài: 
- Fork repo về sau đó làm bài trên repo đó
- Sau khi làm bài xong tạo Pull request vào Repo gốc
- Gửi link PR và mô tả lại bài làm để nộp bài

![Kanban Project Management Dashboard UI for SaaS Platform by Creliq UX/UI Design Agency on Dribbble](https://raw.githubusercontent.com/TechVanguardVn/Task-Management-System/refs/heads/main/images/demo.jpeg)

## 1. Mục tiêu dự án

Xây dựng một ứng dụng quản lý công việc cá nhân hoặc nhóm nhỏ, cho phép người dùng tạo, cập nhật, theo dõi tiến độ và quản lý các công việc của mình.

Ứng viên được tự chọn công nghệ phù hợp với vị trí ứng tuyển. Dự án cần có source code, database, tài liệu hướng dẫn chạy và API nếu có Backend.

## 2. Yêu cầu chức năng

### A. Chức năng bắt buộc (MVP)

1. Quản lý tài khoản

* Đăng ký, đăng nhập, đăng xuất.

* Mật khẩu phải được mã hóa an toàn.

* Người dùng chỉ được truy cập dữ liệu của mình.

2. Quản lý công việc (Task CRUD)

* Tạo, xem, sửa, xóa công việc.

* Mỗi task có tiêu đề, mô tả, trạng thái, mức ưu tiên, hạn hoàn thành.

* Trạng thái: `TODO`, `IN_PROGRESS`, `DONE`.

3. Tìm kiếm và lọc

* Tìm kiếm theo tiêu đề.

* Lọc theo trạng thái và mức ưu tiên.

* Có phân trang nếu dữ liệu lớn.

4. Dashboard

* Tổng số task.

* Số task đã hoàn thành, đang thực hiện và chưa bắt đầu.

* Hiển thị danh sách công việc sắp đến hạn.

### B. Chức năng cộng điểm (không bắt buộc)

* Giao diện Kanban, kéo thả task giữa các trạng thái.

* Docker Compose để khởi chạy ứng dụng.

* Unit test hoặc integration test.

* Swagger/OpenAPI cho tài liệu API.

* CI pipeline chạy test khi push code.

* Deploy demo lên server hoặc nền tảng cloud.

## 3. Công nghệ đề xuất

- Ứng viên được thỏa sức chọn lựa công nghệ
- Gợi ý công nghệ có thể dùng ví dụ: nodejs, PHP/Laravel,...

## 4. Thiết kế database tham khảo

Ứng viên tự thiết kế sao cho đáp ứng nhu cầu đề bài
Yêu cầu: có migration tạo bảng, khóa ngoại và các ràng buộc dữ liệu phù hợp.

## 5. Sản phẩm ứng viên phải bàn giao

### Checklist bàn giao

- Pull Request tạo vào repo gốc
- README: hướng dẫn cài đặt và chạy dự án
- File .env.example, không chứa secret thật
- Database migration và dữ liệu mẫu/seed
- API documentation hoặc hướng dẫn sử dụng
- Danh sách chức năng đã hoàn thành và chức năng chưa hoàn thành
- Video demo 3–5 phút hoặc buổi demo trực tiếp

---

# Bài làm: AIM — Task Management System

Phần trên là đề bài gốc, giữ nguyên. Phần dưới mô tả bài làm trong repo này.

## Tổng quan

Sản phẩm tên là **AIM** (mục tiêu): lập kế hoạch, theo dõi và hoàn thành task chính là đạt được AIM. "Task Management System" là tên đề bài và vẫn được giữ trong tên các tài liệu PRD.

Ứng dụng quản lý công việc theo mô hình **workspace → team → task** (vai trò OWNER / ADMIN / MEMBER), có Kanban kéo thả, dashboard, realtime không polling và AI Smart Task Planner dùng Gemini key do từng người dùng tự cung cấp.

| Thành phần | Công nghệ |
| --- | --- |
| `apps/api` | Node.js 24, TypeScript, Express, PostgreSQL 17, Prisma, OpenAPI tại `/api/openapi.json` (Swagger UI tại `/api/docs`) |
| `apps/web` | Next.js 16 (App Router), React 19, Tailwind CSS 4, shadcn/ui (Radix), TanStack Query 5, zod, dnd-kit, sonner. Giao diện tiếng Anh, có light và dark mode |

Trình duyệt luôn gọi `/api/*` cùng origin. Web server (Next) chuyển tiếp `/api/*` tới API ở cả local lẫn production, nên cookie luôn là first-party. Production dùng hai hostname: web tại `https://task.darrenak.id.vn`, API tại `https://task-api.darrenak.id.vn` (Swagger, health check, gọi trực tiếp).

Giao diện gồm: đăng ký / đăng nhập, danh sách và tạo workspace, quản lý team và thành viên, task dạng danh sách và Kanban (tìm kiếm, lọc, phân trang theo cột), My Tasks, dashboard, trang cài đặt Gemini key, và AI Planner (mục tiêu, tiến trình, câu hỏi làm rõ, bản nháp chỉnh sửa được, versions, xác nhận một lần mới tạo task). Dữ liệu cập nhật qua một `EventSource` cho mỗi tab; sự kiện chỉ kích hoạt tải lại dữ liệu.

## Chạy local

Yêu cầu: Node.js 24.21.0 (xem `.node-version`), npm 11.14.1, Docker (cho PostgreSQL và API).

```sh
cp .env.example .env        # đổi mật khẩu PostgreSQL mẫu; APP_ORIGIN giữ http://localhost:3000
npm ci
npm run docker:dev:up       # PostgreSQL, migration và API tại http://127.0.0.1:4000
npm run dev:web             # web tại http://localhost:3000
```

`npm run dev:web` chuyển tiếp `/api/*` tới `API_PROXY_TARGET` (mặc định `http://localhost:4000`); đặt biến này trong shell hoặc `apps/web/.env.local` nếu API chạy ở nơi khác. Dữ liệu demo là tùy chọn: đặt `SEED_DEMO_DATA=yes` và `SEED_DEMO_PASSWORD` (8 ký tự trở lên) trong `.env`, rồi chạy `npm run docker:dev:seed`. Chi tiết backend nằm ở [apps/api/README.md](apps/api/README.md).

Để dùng AI Planner cần cấu hình thêm keyring mã hóa phía server và token ceiling trong `.env` (xem [runbook](docs/03-operations/backend-operations-runbook.md)); sau đó mỗi người dùng nhập Gemini key của mình ở trang AI settings. Không có Gemini key dùng chung.

## Lệnh thường dùng

Có [Taskfile](Taskfile.yml) cho việc chạy local: `task dev` chạy database và API trong Docker, web bằng dev server có hot reload tại http://localhost:3000; `task seed` tạo dữ liệu mẫu tiếng Việt (hai tài khoản, mỗi người quản lý workspace riêng: `anh@gmail.com` với `AIM Studio` gồm team Backend/Frontend, `khanh@gmail.com` với `Quán Cà Phê Sáng`; chung `SEED_DEMO_PASSWORD`); `task reset` xoá toàn bộ database local rồi seed lại; `task down` dừng database và API (giữ dữ liệu); `task logs` xem log. Taskfile đọc `.env` và `.env.local` ở thư mục gốc.

| Lệnh | Tác dụng |
| --- | --- |
| `npm run dev` | API ở chế độ watch (cần `DATABASE_URL` trỏ tới PostgreSQL đã migrate) |
| `npm run dev:web` | Web dev server, cổng 3000 |
| `npm run lint` / `npm run typecheck` | ESLint và TypeScript cho cả hai app |
| `npm test` | Test của API (cần PostgreSQL riêng cho test, xem apps/api/README.md) rồi test của web |
| `npm run build` | Build API rồi web |
| `npm --workspace @task-management/web run api:types` | Sinh lại `apps/web/src/lib/api-types.ts` từ OpenAPI của API đang chạy ở cổng 4000 |
| `npm run docker:dev:up` / `docker:dev:down` / `docker:dev:logs` / `docker:dev:seed` | Quản lý stack Docker của backend |

## Triển khai

GitHub Actions kiểm tra và đẩy image lên Docker Hub; việc deploy là thủ công.

1. `Backend CI` và `Web CI` chạy trên PR và push vào `dev` / `main` (Web CI chỉ chạy khi `apps/web` hoặc file dùng chung đổi).
2. Sau khi CI xanh trên `main`, `Backend Release` và `Web Release` đẩy `task-management-api`, `task-management-api-migrate` và `task-management-web` lên Docker Hub, gắn tag `sha-<commit>` và `latest`. Hai secret duy nhất là `DOCKERHUB_USERNAME` và `DOCKERHUB_PASSWORD`.
3. Trong Dokploy, đặt `BACKEND_API_IMAGE_REF`, `BACKEND_MIGRATE_IMAGE_REF`, `WEB_IMAGE_REF` cùng các biến runtime còn lại của `docker-compose.prod.yml` rồi bấm **Deploy**. Rollback: đặt ref về tag `sha-<commit>` trước đó và Deploy lại.
4. Trên host, Cloudflare Tunnel cần hai public hostname: `task.darrenak.id.vn` → `http://localhost:4101` (web) và `task-api.darrenak.id.vn` → `http://localhost:4100` (API). `APP_ORIGIN` của API là `https://task.darrenak.id.vn`.

Các bước vận hành, kiểm tra sau deploy, backup và restore: [Backend operations runbook](docs/03-operations/backend-operations-runbook.md).

## Trạng thái

Đã chạy local: typecheck, ESLint, 109 unit test của web, production build, build và khởi động image web (trang login trả 200, chạy bằng user không phải root, filesystem chỉ đọc), build image API, và smoke API qua proxy dev (đăng ký, me, workspace, member, team, task, dashboard, SSE, các endpoint đọc của AI).

**Chưa được kiểm chứng**: kiểm tra trên trình duyệt (kể cả realtime giữa hai trình duyệt), kiểm tra mobile / bàn phím / reduced motion / Lighthouse, một lần sinh kế hoạch thật bằng Gemini, chạy các workflow trên GitHub, đẩy image lên Docker Hub, deploy Dokploy, rule Cloudflare Tunnel và SSE qua tunnel. Chưa có PR nộp bài và video demo.

Hạn chế đã biết: Duplicate plan tạo bản sao trong cùng team vì API clone không nhận team đích. Bảng đối chiếu từng yêu cầu trong PRD, gồm các điểm lệch so với đặc tả AI, ở [PRD traceability](docs/01-requirements/prd-traceability.md).

## Tài liệu

Mục lục và quy ước ở [docs/README.md](docs/README.md): PRD, [System Architecture](docs/02-architecture/system-architecture.md), [AI + Realtime Technical Design](docs/02-architecture/ai-and-realtime-technical-design.md) và [Code standards](docs/code-standards.md).
