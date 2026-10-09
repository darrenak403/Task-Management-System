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
