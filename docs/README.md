# Tài liệu dự án

## Trạng thái

Requirements và architecture là nguồn chuẩn cho phạm vi sản phẩm và quyết định kỹ thuật. Backend code và kiểm chứng local đã hoàn tất; trạng thái phase cùng acceptance evidence được theo dõi trong `plans/261009-1304-backend-implementation/`. Docker Hub/Dokploy/VPS, public browser SSE, frontend và live Gemini vẫn chờ nghiệm thu môi trường thật.

## Tài liệu theo SDLC

| Giai đoạn | Tài liệu | Vai trò |
| --- | --- | --- |
| Đề bài nguồn | [Đề bài tuyển dụng](01-requirements/assignment-brief.md) | Nội dung pre-test do công ty cung cấp; giữ nguyên làm đầu vào. |
| Báo cáo bài làm | [README ở repo root](../README.md) | Đọc đầu tiên: cách thử nhanh, tài khoản demo, chức năng đã làm, hình minh hoạ, phần chưa làm. |
| 01 — Requirements tổng thể | [Task Management System PRD](01-requirements/task-management-system-prd.md) | Nguồn yêu cầu tổng thể: mục tiêu, người dùng, core/bonus/AI/realtime, ranh giới và acceptance IDs. |
| 01 — Requirements phân hệ AI | [AI Smart Task Planner PRD](01-requirements/ai-smart-task-planner-prd.md) | Bản sao nguyên văn product/UX spec được cung cấp; nguồn yêu cầu và acceptance criteria của AI. |
| 02 — Architecture | [System Architecture](02-architecture/system-architecture.md) | Tài liệu kiến trúc chính: quyết định FE/BE, dữ liệu, API, bảo mật và DevOps để đáp ứng PRD. |
| 02 — Architecture | [AI + Realtime Technical Design](02-architecture/ai-and-realtime-technical-design.md) | Thiết kế hai phân hệ dùng chung backend event flow: Gemini/jobs/versions/confirm và SSE/outbox/replay/ACL. |
| Implementation | [Backend code standards](code-standards.md) | Quy tắc ngắn về tổ chức module, bảo mật, transaction, kiểm thử và vận hành trong lúc triển khai. |
| 03 — Operations | [Backend operations runbook](03-operations/backend-operations-runbook.md) | Local Compose, CI/Docker Hub/Dokploy, backup/restore, AI quota quarantine và realtime proxy. |

## Truy vết yêu cầu

| Yêu cầu | Nguồn / tiêu chí | Thiết kế và bằng chứng |
| --- | --- | --- |
| Core A1–A3, W1–W4, T1–T2, L1–L3, D1–D2, B1–B6, H1–H2 | README gốc + Task Management System PRD | System Architecture; kiểm chứng ở mục 10 và bàn giao |
| AI1, AI2, AC-01–AC-10, AI-A1–AI-A9 | Task Management System PRD + AI Planner PRD | [AI + Realtime Technical Design](02-architecture/ai-and-realtime-technical-design.md); nghiệm thu/kiểm thử AI và BYOK isolation |
| RT1, RT-01–RT-08 | Task Management System PRD và tiêu chí realtime đã chốt | [AI + Realtime Technical Design](02-architecture/ai-and-realtime-technical-design.md#1510-nghiệm-thu-và-cập-nhật-kế-hoạch); kiểm tra hai browser, reconnect, revoke và proxy |

Task Management System PRD là nguồn chuẩn cho yêu cầu tổng thể; README gốc và AI PRD là đầu vào. System Architecture là nguồn chuẩn cho quyết định kiến trúc dùng chung. Tài liệu AI + realtime bổ sung thiết kế theo miền; khi đổi yêu cầu, cập nhật PRD và acceptance IDs; khi đổi quyết định kỹ thuật, cập nhật System Architecture và tài liệu thiết kế liên quan.

## Quy ước tên và bước tiếp theo

- Thư mục có tiền tố số thể hiện thứ tự SDLC; tên file dùng `kebab-case` và nêu loại/nội dung tài liệu.
- Giữ product spec nguồn nguyên văn; cập nhật yêu cầu tại nguồn tương ứng rồi kiểm tra lại acceptance criteria và các tài liệu thiết kế liên quan.
- Backend plan và acceptance evidence nằm trong `plans/261009-1304-backend-implementation/plan.md`; kiểm chứng local không thay thế nghiệm thu Docker Hub/Dokploy/VPS, public browser SSE hoặc live Gemini.
- Khi đổi implementation có ảnh hưởng tới hành vi đã thiết kế, cập nhật requirements/design và kết quả kiểm thử tương ứng; không dùng tài liệu thiết kế thay bằng chứng runtime.
