# AIM — Task Management System: SRS và hướng dẫn kiểm thử

Tài liệu mô tả bài làm cho [đề bài](README.md): hệ thống làm được gì, dữ liệu nào có sẵn để thử, và từng ca kiểm thử kèm kết quả mong đợi. Mục 1 đủ để thử ngay; mục 5 là kịch bản kiểm thử đầy đủ.

## 1. Thông tin truy cập

| | |
| --- | --- |
| Ứng dụng | https://task.darrenak.id.vn |
| Swagger UI | https://task-api.darrenak.id.vn/api/docs |
| OpenAPI JSON | https://task-api.darrenak.id.vn/api/openapi.json |
| Health check | https://task-api.darrenak.id.vn/api/health/ready |

| Tài khoản demo | Mật khẩu | Workspace | Vai trò |
| --- | --- | --- | --- |
| `anh@gmail.com` | `12345@Abc` | AIM Studio | Owner |
| `khanh@gmail.com` | `12345@Abc` | Quán Cà Phê Sáng | Owner |

Hai tài khoản thuộc hai workspace tách biệt, dùng để kiểm tra việc cách ly dữ liệu. Có thể đăng ký thêm tài khoản tại `/register`.

Giao diện có tiếng Anh và tiếng Việt (nút cờ ở góc trên), light và dark mode. Tên nút trong tài liệu này viết theo giao diện tiếng Việt.

## 2. Tổng quan hệ thống

Đề bài yêu cầu quản lý công việc cho cá nhân hoặc nhóm nhỏ. Bài làm tổ chức dữ liệu theo ba cấp:

```text
Workspace (không gian làm việc của một cá nhân hoặc tổ chức)
└── Team (nhóm trong workspace)
    └── Task (công việc; có checklist và phụ thuộc vào task khác)
```

| Thành phần | Công nghệ |
| --- | --- |
| Web (`apps/web`) | Next.js 16, React 19, Tailwind CSS 4, shadcn/ui, TanStack Query, dnd-kit |
| API (`apps/api`) | Node.js 24, TypeScript, Express, Prisma, PostgreSQL 17 |
| Hạ tầng | Docker Compose, GitHub Actions, Docker Hub, Dokploy, Cloudflare Tunnel |

Trình duyệt chỉ gọi `/api/*` trên cùng địa chỉ với web; web server chuyển tiếp sang API.

### Vai trò

Vai trò gắn với từng workspace. Không có tài khoản quản trị toàn hệ thống.

| Việc | Owner | Manager | Member |
| --- | --- | --- | --- |
| Xem, tạo, sửa task trong team mình thuộc | Có | Có | Có |
| Xem, tạo, sửa task của mọi team trong workspace | Có | Có | Không |
| Xoá task | Mọi task | Mọi task | Chỉ task mình tạo |
| Đổi tên workspace; tạo, đổi tên team | Có | Có | Không |
| Xem danh sách thành viên, thêm thành viên, xếp người vào team | Có | Có | Không |
| Xoá thành viên | Manager và Member | Chỉ Member | Không |
| Đổi vai trò người khác | Có | Không | Không |

Owner là người tạo workspace và không đổi được. "Manager" là tên hiển thị; giá trị trong API và database là `ADMIN`. Giao diện ẩn hoặc hiện nút theo bảng này; API kiểm tra lại quyền ở mọi request.

## 3. Yêu cầu chức năng

Cột "Đề bài" ghi mục tương ứng trong README: A là bắt buộc, B là cộng điểm, "Thêm" là phần làm ngoài đề bài.

### 3.1 Tài khoản

| Mã | Chức năng | Chi tiết | Đề bài |
| --- | --- | --- | --- |
| AUTH-1 | Đăng ký | Email, mật khẩu 8–128 ký tự, tên hiển thị (không bắt buộc). Email đã dùng thì báo lỗi ngay tại ô email. | A.1 |
| AUTH-2 | Đăng nhập | Phiên lưu phía server; cookie `HttpOnly`, `SameSite=Lax`, `Secure`. Sai email hoặc mật khẩu trả cùng một thông báo. | A.1 |
| AUTH-3 | Đăng xuất | Thu hồi phiên phía server; cookie cũ không dùng lại được. | A.1 |
| AUTH-4 | Mã hoá mật khẩu | Băm bằng Argon2id. Response và log không chứa hash. | A.1 |
| AUTH-5 | Cách ly dữ liệu | Người ngoài workspace nhận 404 cho mọi tài nguyên của workspace đó, kể cả khi biết đúng ID. | A.1 |

### 3.2 Workspace, team, thành viên

| Mã | Chức năng | Chi tiết | Đề bài |
| --- | --- | --- | --- |
| WS-1 | Tạo và đổi tên workspace | Người tạo trở thành Owner. | Thêm |
| WS-2 | Tạo và đổi tên team | Owner và Manager. | Thêm |
| WS-3 | Thêm thành viên | Tìm theo email của tài khoản đã đăng ký; thêm với vai trò Manager hoặc Member. | Thêm |
| WS-4 | Xếp thành viên vào team | Member chỉ thấy team mình được xếp vào. | Thêm |
| WS-5 | Đổi vai trò, xoá thành viên | Theo bảng vai trò ở mục 2. | Thêm |

### 3.3 Task

| Mã | Chức năng | Chi tiết | Đề bài |
| --- | --- | --- | --- |
| TASK-1 | Tạo task | Tiêu đề bắt buộc, tối đa 200 ký tự. Mô tả tối đa 5.000 ký tự. | A.2 |
| TASK-2 | Xem task | Dạng danh sách và dạng Kanban; mở task để xem đầy đủ. | A.2 |
| TASK-3 | Sửa task | Mọi trường, kể cả trạng thái. | A.2 |
| TASK-4 | Xoá task | Có hộp thoại xác nhận. | A.2 |
| TASK-5 | Các trường của task | Tiêu đề, mô tả, trạng thái (`TODO`, `IN_PROGRESS`, `DONE`), ưu tiên (`LOW`, `MEDIUM`, `HIGH`), hạn hoàn thành. | A.2 |
| TASK-6 | Trường mở rộng | Người được giao (phải thuộc team), ngày bắt đầu, ước lượng thời gian, tiêu chí hoàn thành, lý do ưu tiên. | Thêm |
| TASK-7 | Checklist | Các bước nhỏ trong một task, đánh dấu xong từng bước. | Thêm |
| TASK-8 | Phụ thuộc | Một task có thể cần task khác xong trước; không cho tạo vòng lặp. | Thêm |

### 3.4 Tìm kiếm, lọc, phân trang

| Mã | Chức năng | Chi tiết | Đề bài |
| --- | --- | --- | --- |
| FIND-1 | Tìm theo tiêu đề | Khớp một phần, không phân biệt hoa thường, có phân biệt dấu tiếng Việt. Tự tìm sau 300 ms ngừng gõ. | A.3 |
| FIND-2 | Lọc theo trạng thái | | A.3 |
| FIND-3 | Lọc theo ưu tiên | | A.3 |
| FIND-4 | Kết hợp điều kiện | Tìm kiếm và các bộ lọc áp dụng đồng thời; điều kiện nằm trên URL nên chia sẻ được. | A.3 |
| FIND-5 | Phân trang | 20 task mỗi trang ở danh sách; mỗi cột Kanban hiện tổng số và tải thêm 20 task mỗi lần. | A.3 |

### 3.5 Dashboard

| Mã | Chức năng | Chi tiết | Đề bài |
| --- | --- | --- | --- |
| DASH-1 | Tổng số task | Trong phạm vi người xem được phép thấy. | A.4 |
| DASH-2 | Số task theo trạng thái | Cần làm, đang làm, hoàn thành. Ba số cộng lại bằng tổng. | A.4 |
| DASH-3 | Sắp đến hạn | Task chưa `DONE` có hạn từ hôm nay đến 6 ngày tới, theo giờ Việt Nam. | A.4 |
| DASH-4 | My Tasks | Các task được giao cho mình trong workspace. | Thêm |

### 3.6 Phần cộng điểm

| Mã | Chức năng | Chi tiết | Đề bài |
| --- | --- | --- | --- |
| BONUS-1 | Kanban kéo thả | Chuột, cảm ứng và bàn phím. Thẻ chuyển ngay, tự hoàn lại nếu server từ chối. | B |
| BONUS-2 | Docker Compose | `docker-compose.prod.yml` chạy database, migration, API và web; đây là stack của bản demo. `docker-compose.dev.yml` chạy database, migration và API, web chạy bằng dev server. | B |
| BONUS-3 | Test | API: 133 test, phần lớn chạy trên PostgreSQL thật. Web: 113 unit test. | B |
| BONUS-4 | Swagger / OpenAPI | 49 operation. Kiểu dữ liệu phía web sinh từ OpenAPI. | B |
| BONUS-5 | CI | `Backend CI` và `Web CI` chạy audit, lint, typecheck, test, build trên mỗi PR và push vào `dev`, `main`. | B |
| BONUS-6 | Deploy demo | CI xanh trên `main` thì đẩy image lên Docker Hub; deploy bằng Dokploy. | B |

### 3.7 Phần làm thêm

| Mã | Chức năng | Chi tiết |
| --- | --- | --- |
| RT-1 | Cập nhật tức thời | Thay đổi của người khác tự hiện trên màn hình qua Server-Sent Events; không polling. |
| AI-1 | Gemini key cá nhân | Mỗi người nhập key của mình; key mã hoá phía server và không hiển thị lại. Không có key dùng chung. |
| AI-2 | AI Planner | Nhập mục tiêu → AI hỏi lại nếu thiếu thông tin → bản nháp task có hạn, ước lượng, phụ thuộc → người dùng sửa và xác nhận thì task mới được tạo. |
| AI-3 | Phiên bản kế hoạch | Làm lại, đơn giản hoá, thêm chi tiết, đổi hạn chót; mỗi lần tạo một phiên bản mới. |
| I18N-1 | Hai ngôn ngữ | Tiếng Anh và tiếng Việt cho giao diện. |

## 4. Dữ liệu kiểm thử

Dữ liệu demo được tạo ngày 09/10/2026; hạn hoàn thành tính tương đối theo ngày đó. Các con số dưới đây đúng với dữ liệu gốc và sẽ đổi khi có người thêm, sửa, xoá task.

### 4.1 Tổng hợp

| Workspace | Team | Số task | `TODO` | `IN_PROGRESS` | `DONE` | `HIGH` | `MEDIUM` | `LOW` |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| AIM Studio | Backend | 24 | 12 | 5 | 7 | 10 | 8 | 6 |
| AIM Studio | Frontend | 14 | 7 | 3 | 4 | 5 | 6 | 3 |
| **AIM Studio** | **cả hai team** | **38** | **19** | **8** | **11** | 15 | 14 | 9 |
| Quán Cà Phê Sáng | Vận hành | 6 | 4 | 1 | 1 | 2 | 3 | 1 |

Team Backend có 24 task nên danh sách chia thành 2 trang (20 + 4). Trong dữ liệu có task quá hạn, task hạn hôm nay, task không có hạn và task chưa giao cho ai.

### 4.2 Giá trị tìm kiếm và lọc, team Backend

| Thao tác | Kết quả mong đợi |
| --- | --- |
| Không lọc | 24 task, 2 trang |
| Tìm `API` | 7 task |
| Tìm `api` (chữ thường) | 7 task, giống trên |
| Tìm `thanh toán` | 5 task |
| Tìm `thanh toan` (không dấu) | 0 task |
| Lọc trạng thái Đang làm | 5 task |
| Lọc ưu tiên Cao | 10 task |
| Lọc Đang làm + Cao | 4 task |
| Tìm `thanh toán` + lọc Cần làm | 2 task |

### 4.3 Task tiêu biểu để mở xem

| Task | Team | Có gì để xem |
| --- | --- | --- |
| Tích hợp cổng thanh toán VNPay (sandbox) | Backend | Checklist 4 bước, phụ thuộc vào 2 task khác, đang làm và đã quá hạn |
| Xử lý webhook xác nhận thanh toán | Backend | Checklist 3 bước (1 bước đã xong), có task khác đang chờ nó |
| Sửa lỗi tồn kho âm khi hai người đặt cùng lúc | Backend | Chưa giao cho ai, ưu tiên Cao |
| Ghi log có mã truy vết cho mọi request | Backend | Không có hạn hoàn thành |
| Giao diện giỏ hàng | Frontend | Checklist 4 bước, có phụ thuộc |
| Kiểm kê nguyên liệu cuối tuần | Vận hành | Checklist 3 bước |

### 4.4 Dữ liệu để nhập khi thử

| Mục đích | Giá trị |
| --- | --- |
| Tài khoản mới | Email bất kỳ chưa dùng, ví dụ `tester01@example.com`; mật khẩu `Test@12345` |
| Mật khẩu không hợp lệ | `1234567` (7 ký tự) |
| Email đã tồn tại | `anh@gmail.com` |
| Task mới | Tiêu đề `Kiểm thử chức năng tạo task`, ưu tiên Cao, hạn là ngày mai |
| Tiêu đề không hợp lệ | Để trống |
| Mục tiêu cho AI Planner | `Ra mắt trang đặt bàn online cho quán trong 2 tuần` |

## 5. Kịch bản kiểm thử

### 5.1 Tài khoản và cách ly dữ liệu

| # | Bước | Kết quả mong đợi | Mã |
| --- | --- | --- | --- |
| 1 | Mở `/register`, nhập email mới và mật khẩu `1234567` | Báo lỗi mật khẩu quá ngắn, không tạo tài khoản | AUTH-1 |
| 2 | Đăng ký với email `anh@gmail.com` | Báo email đã được dùng | AUTH-1 |
| 3 | Đăng ký với email mới và mật khẩu `Test@12345` | Vào ứng dụng, danh sách workspace trống | AUTH-1 |
| 4 | Đăng xuất rồi mở lại địa chỉ `/workspaces` | Bị đưa về trang đăng nhập | AUTH-3 |
| 5 | Đăng nhập `anh@gmail.com` với mật khẩu sai | "Email hoặc mật khẩu không đúng." | AUTH-2 |
| 6 | Đăng nhập `anh@gmail.com` / `12345@Abc` | Thấy workspace AIM Studio, không thấy Quán Cà Phê Sáng | AUTH-2, AUTH-5 |
| 7 | Mở một task của AIM Studio, sao chép URL. Đăng xuất, đăng nhập `khanh@gmail.com`, dán URL | Không xem được task; chỉ thấy Quán Cà Phê Sáng | AUTH-5 |

### 5.2 Task

Đăng nhập `anh@gmail.com`, mở AIM Studio → team Backend.

| # | Bước | Kết quả mong đợi | Mã |
| --- | --- | --- | --- |
| 8 | Bấm tạo task, để trống tiêu đề rồi lưu | Báo lỗi tại ô tiêu đề | TASK-1 |
| 9 | Tạo task `Kiểm thử chức năng tạo task`, ưu tiên Cao, hạn ngày mai | Task xuất hiện trong danh sách; tổng tăng lên 25 | TASK-1, TASK-5 |
| 10 | Mở task vừa tạo, đổi mô tả và ưu tiên thành Thấp, lưu | Danh sách hiện giá trị mới, không cần tải lại trang | TASK-3 |
| 11 | Mở "Tích hợp cổng thanh toán VNPay (sandbox)" | Thấy checklist 4 bước và 2 task phải xong trước | TASK-7, TASK-8 |
| 12 | Đánh dấu xong một bước trong checklist | Bước đó được lưu là đã xong | TASK-7 |
| 13 | Xoá task đã tạo ở bước 9 | Có hộp thoại xác nhận; sau đó tổng về 24 | TASK-4 |

### 5.3 Tìm kiếm, lọc, phân trang

| # | Bước | Kết quả mong đợi | Mã |
| --- | --- | --- | --- |
| 14 | Xem danh sách team Backend, chuyển sang trang 2 | Trang 1 có 20 task, trang 2 có 4 task | FIND-5 |
| 15 | Gõ `API` vào ô tìm kiếm | 7 task | FIND-1 |
| 16 | Xoá ô tìm kiếm, lọc Đang làm + Cao | 4 task | FIND-2, FIND-3, FIND-4 |
| 17 | Tìm `thanh toán` + lọc Cần làm, rồi tải lại trang | 2 task; điều kiện vẫn còn sau khi tải lại | FIND-4 |

### 5.4 Dashboard và Kanban

| # | Bước | Kết quả mong đợi | Mã |
| --- | --- | --- | --- |
| 18 | Mở Dashboard của AIM Studio | Tổng 38; Cần làm 19, Đang làm 8, Hoàn thành 11 | DASH-1, DASH-2 |
| 19 | Xem danh sách sắp đến hạn | Chỉ có task chưa hoàn thành, hạn từ hôm nay đến 6 ngày tới | DASH-3 |
| 20 | Mở Kanban của team Backend | Ba cột, mỗi cột ghi tổng số: 12, 5, 7 | BONUS-1 |
| 21 | Kéo một thẻ từ Cần làm sang Đang làm | Thẻ chuyển ngay; số ở hai cột đổi thành 11 và 6 | BONUS-1 |
| 22 | Quay lại Dashboard | Cần làm 18, Đang làm 9 | DASH-2 |
| 23 | Kéo thẻ đó về lại cột cũ | Số liệu trở về như ban đầu | BONUS-1 |

### 5.5 Thành viên và phân quyền

Cần tài khoản đã đăng ký ở bước 3 (gọi là tài khoản thử).

| # | Bước | Kết quả mong đợi | Mã |
| --- | --- | --- | --- |
| 24 | Là `anh`, mở phần thành viên của AIM Studio, thêm tài khoản thử theo email với vai trò Member | Tài khoản thử xuất hiện trong danh sách | WS-3 |
| 25 | Xếp tài khoản thử vào team Frontend | Tài khoản thử là thành viên team Frontend | WS-4 |
| 26 | Đăng nhập tài khoản thử, mở AIM Studio | Chỉ thấy team Frontend; không thấy team Backend và phần quản lý thành viên | WS-4 |
| 27 | Là tài khoản thử, mở một task do `anh` tạo | Sửa được, không có nút xoá | TASK-4 |
| 28 | Là tài khoản thử, tạo một task rồi xoá | Xoá được task của chính mình | TASK-4 |
| 29 | Là `anh`, đổi tài khoản thử thành Manager | Tài khoản thử thấy cả hai team và phần quản lý thành viên | WS-5 |
| 30 | Là `anh`, xoá tài khoản thử khỏi workspace | Tài khoản thử không còn thấy AIM Studio | WS-5 |

### 5.6 Cập nhật tức thời

| # | Bước | Kết quả mong đợi | Mã |
| --- | --- | --- | --- |
| 31 | Mở Kanban team Backend ở hai cửa sổ trình duyệt, cùng đăng nhập `anh`. Kéo một thẻ ở cửa sổ thứ nhất | Cửa sổ thứ hai tự cập nhật, không cần tải lại | RT-1 |

### 5.7 AI Planner

Cần một Gemini API key của người thử, lấy tại Google AI Studio.

| # | Bước | Kết quả mong đợi | Mã |
| --- | --- | --- | --- |
| 32 | Mở AI Planner khi chưa nhập key | Được hướng dẫn sang trang cài đặt AI | AI-1 |
| 33 | Vào cài đặt AI, dán key, chọn model `gemini-3.5-flash-lite`, bấm kiểm tra kết nối | Báo kết nối thành công; key không hiển thị lại | AI-1 |
| 34 | Mở AI Planner của một team, nhập mục tiêu ở mục 4.4, gửi | Thấy tiến trình theo từng bước; có thể có câu hỏi làm rõ | AI-2 |
| 35 | Trả lời câu hỏi (nếu có) | Nhận bản nháp gồm các task có hạn, ước lượng, phụ thuộc | AI-2 |
| 36 | Mở danh sách task của team | Chưa có task mới nào | AI-2 |
| 37 | Bỏ chọn một task trong bản nháp, sửa tiêu đề một task khác, bấm xác nhận | Đúng số task đã chọn được tạo trong team | AI-2 |

Trang AI Planner hiện số lượt còn lại trong ngày.

### 5.8 API

| # | Bước | Kết quả mong đợi | Mã |
| --- | --- | --- | --- |
| 38 | Mở Swagger UI | Liệt kê 49 operation theo nhóm | BONUS-4 |
| 39 | Mở địa chỉ health check | Trả 200; header `X-Release-Sha` là commit đang chạy | BONUS-6 |

## 6. Quy tắc nghiệp vụ

| Quy tắc | Giá trị |
| --- | --- |
| Mật khẩu | 8 đến 128 ký tự |
| Tiêu đề task | Bắt buộc, tối đa 200 ký tự |
| Mô tả task | Tối đa 5.000 ký tự |
| Người được giao | Phải là thành viên của team chứa task |
| Phụ thuộc giữa task | Không được tạo vòng lặp |
| Sắp đến hạn | Hôm nay đến 6 ngày tới, giờ Việt Nam, không tính task `DONE` |
| Xoá task | Member chỉ xoá task mình tạo |
| Ai dùng AI Planner | Owner và Manager ở mọi team; Member ở team mình thuộc |
| Kế hoạch AI | Chỉ người tạo nhìn thấy; chưa xác nhận thì chưa tạo task |
| Giới hạn AI mỗi ngày | 10 lượt mỗi người, 30 mỗi workspace, 100 toàn hệ thống; tính theo ngày giờ Việt Nam |
| Giới hạn mỗi yêu cầu AI | Tối đa 4 lần gọi model, tính cả lần thử lại |

## 7. Yêu cầu phi chức năng

| Hạng mục | Cách đáp ứng |
| --- | --- |
| Bảo mật | Argon2id; cookie phiên `HttpOnly`, `SameSite=Lax`, `Secure`; kiểm tra quyền ở API cho mọi request; Gemini key mã hoá phía server; container chạy bằng user thường, filesystem chỉ đọc. |
| Toàn vẹn dữ liệu | 10 migration tạo bảng, khoá ngoại và ràng buộc. Ví dụ: người được giao phải thuộc team của task; ước lượng tối thiểu không lớn hơn tối đa. |
| Chất lượng | ESLint, TypeScript strict, 133 test API và 113 test web chạy trong CI. |
| Vận hành | Health check, migration chạy trước khi API khởi động, rollback bằng cách chọn lại tag image cũ. |

## 8. Chạy local

Cần Node.js 24.21.0, npm 11 và Docker.

```sh
cp .env.example .env        # đổi mật khẩu PostgreSQL mẫu; giữ APP_ORIGIN=http://localhost:3000
npm ci
npm run docker:dev:up       # PostgreSQL, migration và API tại http://127.0.0.1:4000
npm run dev:web             # web tại http://localhost:3000
```

Dữ liệu demo: đặt `SEED_DEMO_DATA=yes` và `SEED_DEMO_PASSWORD` (từ 8 ký tự) trong `.env`, rồi chạy `npm run docker:dev:seed`. Chạy lại nhiều lần vẫn an toàn; lệnh này tạo đúng bộ dữ liệu ở mục 4.

| Lệnh | Tác dụng |
| --- | --- |
| `npm run lint` / `npm run typecheck` | ESLint và TypeScript cho cả hai app |
| `npm test` | Test của API (cần một PostgreSQL riêng cho test, xem [apps/api/README.md](apps/api/README.md)) rồi test của web |
| `npm run docker:dev:down` | Dừng database và API, giữ dữ liệu |

Nếu có [Task](https://taskfile.dev/): `task dev` chạy cả stack, `task seed` tạo dữ liệu demo, `task reset` xoá database local rồi seed lại.

AI Planner ở local cần thêm keyring mã hoá và giới hạn token trong `.env`; cách đặt nằm trong [runbook](docs/03-operations/backend-operations-runbook.md).

## 9. Checklist bàn giao

| Hạng mục trong đề bài | Trạng thái | Ở đâu |
| --- | --- | --- |
| Pull Request vào repo gốc | Chưa | |
| Hướng dẫn cài đặt và chạy | Xong | Mục 8 và [apps/api/README.md](apps/api/README.md). README giữ nguyên đề bài. |
| `.env.example` không chứa secret thật | Xong | [.env.example](.env.example) |
| Migration và dữ liệu mẫu | Xong | `apps/api/prisma/migrations`, `apps/api/prisma/seed.ts`, `apps/api/prisma/seed-data.ts` |
| Tài liệu API | Xong | Swagger UI và OpenAPI JSON ở mục 1 |
| Danh sách chức năng đã và chưa hoàn thành | Xong | Mục 3 và mục 10 |
| Video demo 3–5 phút hoặc demo trực tiếp | Chưa | |

## 10. Chưa hoàn thành và hạn chế

Chưa làm:

- Pull Request vào repo gốc và video demo.
- Đăng nhập bằng Google hoặc Facebook, quên mật khẩu: có hiển thị nhưng bị khoá.
- AI Planner: chưa cho AI làm lại riêng một task hay một trường (chỉ làm lại cả kế hoạch); chưa so sánh hai phiên bản kế hoạch; chưa có chỗ khai báo năng lực làm việc của từng thành viên; nhân bản kế hoạch chỉ tạo bản sao trong cùng team.
- Dev Compose chưa gồm web.

Hạn chế đã biết:

- Tìm kiếm phân biệt dấu tiếng Việt: `thanh toan` không tìm ra `thanh toán`.
- Một số thông báo sinh từ server vẫn bằng tiếng Anh khi giao diện là tiếng Việt: cảnh báo trong kế hoạch AI, lỗi kiểm tra dữ liệu từng trường.
- Màn hình không tự làm mới khi sang ngày mới hoặc khi quay lại tab, nên danh sách sắp đến hạn có thể cũ cho tới lần thay đổi dữ liệu kế tiếp.

Chưa kiểm chứng trên bản demo công khai:

- Cập nhật tức thời giữa hai trình duyệt (ca 31).
- Giao diện trên điện thoại, điều hướng chỉ bằng bàn phím, điểm Lighthouse.

## 11. Tài liệu chi tiết

| Tài liệu | Nội dung |
| --- | --- |
| [PRD](docs/01-requirements/task-management-system-prd.md) | Yêu cầu đầy đủ và mã tiêu chí nghiệm thu |
| [PRD traceability](docs/01-requirements/prd-traceability.md) | Từng tiêu chí ứng với file code và test nào |
| [System architecture](docs/02-architecture/system-architecture.md) | Quyết định kiến trúc, mô hình dữ liệu, bảo mật |
| [AI + Realtime technical design](docs/02-architecture/ai-and-realtime-technical-design.md) | Thiết kế AI Planner và cập nhật tức thời |
| [Operations runbook](docs/03-operations/backend-operations-runbook.md) | Deploy, rollback, backup, restore |
