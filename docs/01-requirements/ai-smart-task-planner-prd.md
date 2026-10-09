# AI SMART TASK PLANNER — PRODUCT & UX SPECIFICATION

> **Loại tài liệu:** Đặc tả ý tưởng, nghiệp vụ, UX và tiêu chí nghiệm thu — độc lập công nghệ  
> **Sản phẩm:** Ứng dụng quản lý công việc cá nhân hoặc nhóm nhỏ  
> **Tính năng:** AI Smart Task Planner / AI Planning Assistant  
> **Trạng thái:** Đề xuất triển khai (Product Specification v1.0)  
> **Mục tiêu:** Chuyển một mục tiêu bằng ngôn ngữ tự nhiên thành kế hoạch công việc có cấu trúc, có thể xem lại, điều chỉnh và đưa vào hệ thống quản lý công việc.

---

## 1. TỔNG QUAN Ý TƯỞNG

**AI Smart Task Planner** là trợ lý lập kế hoạch giúp người dùng chuyển ý tưởng, yêu cầu hoặc mục tiêu chưa rõ ràng thành một danh sách công việc cụ thể và có thể thực hiện.

Người dùng chỉ cần mô tả một mục tiêu, ví dụ:

> “Tôi muốn xây dựng website bán hàng trong 14 ngày, gồm đăng nhập, danh mục sản phẩm, giỏ hàng, thanh toán và kiểm thử. Có 2 thành viên tham gia.”

Hệ thống đề xuất:

- Các **task** chính và **subtask** tương ứng.
- **Mục tiêu đầu ra / tiêu chí hoàn thành** cho từng task.
- **Độ ưu tiên** và lý do ngắn gọn.
- **Ước lượng công sức** và **thời điểm dự kiến** thực hiện.
- **Quan hệ phụ thuộc** giữa các công việc (nếu có).
- **Gợi ý người phụ trách** chỉ khi có đủ thông tin về thành viên và vai trò.
- **Rủi ro, giả định, điểm cần làm rõ** trong kế hoạch.

Kết quả AI chỉ là **bản nháp đề xuất**. Người dùng duyệt, chỉnh sửa, chọn công việc và xác nhận thì các task mới trở thành dữ liệu thật của ứng dụng.

### Giá trị nổi bật

1. Giảm thời gian lập kế hoạch thủ công.
2. Giúp người mới bắt đầu xác định việc cần làm và thứ tự thực hiện.
3. Hỗ trợ lập kế hoạch có deadline, priority và dependencies thay vì chỉ tạo một danh sách việc đơn giản.
4. Tạo một điểm nhấn AI hữu ích, thể hiện tính sản phẩm trong ứng dụng quản lý task.

### Nguyên tắc sản phẩm

- **AI đề xuất, con người quyết định.** Không tự động tạo, xóa, giao việc hoặc thay đổi công việc đang tồn tại nếu chưa được người dùng xác nhận.
- **Minh bạch về sự không chắc chắn.** Thời gian, độ ưu tiên và phân công là ước lượng dựa trên thông tin cung cấp.
- **Không bịa dữ liệu.** Không tự thêm tên thành viên, ngày bắt đầu, năng lực, lịch rảnh hoặc dự án không tồn tại.
- **Tôn trọng dữ liệu người dùng.** Chỉ sử dụng thông tin liên quan và thuộc phạm vi người dùng được phép truy cập.
- **Tập trung vào khả năng hành động.** Mỗi task cần có mô tả rõ và điều kiện hoàn thành có thể kiểm chứng.

---

## 2. ĐỐI TƯỢNG VÀ NGỮ CẢNH SỬ DỤNG

### Người dùng cá nhân

Muốn biến mục tiêu học tập, công việc hoặc dự án cá nhân thành checklist theo ngày/tuần. Ví dụ: học tiếng Anh 30 ngày, làm portfolio, chuẩn bị phỏng vấn.

### Nhóm nhỏ

Muốn lập kế hoạch dự án, phân chia đầu việc và theo dõi tiến độ. Ví dụ: ra mắt landing page, xây dựng MVP, tổ chức sự kiện, chiến dịch nội dung.

### Điểm truy cập tính năng

- Nút nổi bật **“Plan with AI”** ở trang Dashboard.
- Nút **“Generate with AI”** ở danh sách công việc.
- Hành động **“Create project plan”** bên trong một Project.
- Tại trạng thái rỗng (empty state): **“Describe your goal and let AI create a plan.”**

Ở phiên bản đầu, các điểm truy cập có thể dùng chung một luồng lập kế hoạch.

---

## 3. PHẠM VI TÍNH NĂNG

### 3.1. Bắt buộc (MVP)

1. Nhập mục tiêu bằng văn bản tự nhiên.
2. Bổ sung thời hạn và bối cảnh tối thiểu (tùy chọn).
3. Kích hoạt AI lập kế hoạch.
4. Hiển thị **AI Planning Progress Timeline** theo trạng thái thực tế.
5. Hiển thị bản kế hoạch có task, subtask, priority, thời gian dự kiến.
6. Cho phép chỉnh sửa, bỏ chọn hoặc xóa khỏi bản nháp từng task trước khi lưu.
7. Cho phép chọn dự án/không gian chứa kế hoạch.
8. Xác nhận tạo các task đã chọn.
9. Thông báo kết quả tạo task, chỉ ra task thành công/thất bại nếu có.
10. Xử lý rõ ràng trường hợp đầu vào thiếu thông tin, AI không tạo được kế hoạch, người dùng hủy hoặc thử lại.

### 3.2. Nâng cao (nếu còn thời gian)

- Phát hiện lịch làm việc bị quá tải hoặc deadline thiếu thực tế.
- Gợi ý phân chia nhiệm vụ theo vai trò của thành viên có thật.
- Đề xuất quan hệ phụ thuộc và cảnh báo khi thứ tự làm việc không hợp lý.
- “Regenerate this task” / “Make this plan simpler” / “Make it more detailed”.
- Chọn chiến lược lập kế hoạch: **Fastest**, **Balanced**, **Quality-first**.
- Đọc các task hiện có trong dự án để gợi ý không trùng lặp (chỉ khi người dùng cho phép).
- Lưu lịch sử các bản kế hoạch nháp và so sánh phiên bản.
- Hỗ trợ người dùng tự yêu cầu AI điều chỉnh kế hoạch khi thay đổi deadline.

### 3.3. Ngoài phạm vi MVP

- Chatbot tổng quát cho toàn ứng dụng.
- Tự lập kế hoạch lại âm thầm khi dữ liệu thay đổi.
- AI tự giao nhiệm vụ, tự thay đổi deadline hoặc tự xóa task thật.
- Dự đoán chính xác thời gian hoàn thành hoặc năng suất cá nhân.
- Tự động thực thi các công việc bên ngoài ứng dụng.

---

## 4. LUỒNG TRẢI NGHIỆM TỪ ĐẦU ĐẾN CUỐI

### Bước 1 — Mở AI Planner

Người dùng chọn **Plan with AI**. Một màn hình hoặc cửa sổ chuyên biệt mở ra với phần giới thiệu ngắn:

**Tiêu đề:** “Turn your goal into an actionable plan”  
**Mô tả:** “Describe what you want to achieve. AI will suggest tasks, priorities and a timeline.”

**Trường chính (bắt buộc):**

- **What do you want to achieve?** — ô nhập mục tiêu nhiều dòng, có placeholder và ví dụ gợi ý.

**Trường phụ (tùy chọn):**

- **Target completion date / Duration:** ngày kết thúc mong muốn hoặc số ngày/tuần.
- **Start date:** ngày bắt đầu, nếu có.
- **Project / Workspace:** nơi dự định lưu các task.
- **Team context:** số thành viên hoặc vai trò liên quan; không cần tự điền tên nếu đã chọn được thành viên thực.
- **Detail level:** Simple / Balanced / Detailed.
- **Additional constraints:** ngân sách, lịch rảnh, mức ưu tiên chất lượng, giới hạn thời gian mỗi ngày, yêu cầu không thể bỏ qua.

**Hành động:** “Generate plan”. Nếu nội dung quá ngắn/mơ hồ, hệ thống gợi ý bổ sung thay vì tạo một kế hoạch thiếu căn cứ.

### Bước 2 — Xác thực ý định

Trước khi lập kế hoạch, hệ thống cần phân biệt:

- Mục tiêu rõ → tiếp tục.
- Mục tiêu thiếu dữ liệu nhưng vẫn có thể lập kế hoạch → tiếp tục với giả định được ghi rõ.
- Mục tiêu không xác định hoặc mâu thuẫn nghiêm trọng → đặt tối đa **1–3 câu hỏi làm rõ**, ưu tiên những thông tin ảnh hưởng lớn đến kế hoạch.

Không biến form thành một bảng khảo sát dài. Có thể cung cấp nút **“Continue with assumptions”**.

### Bước 3 — Hiển thị tiến trình tạo kế hoạch

Chuyển sang giao diện **AI Planning Progress Timeline**. Người dùng thấy các bước công việc, trạng thái đang xử lý, bước đã hoàn thành và thông báo ngắn.

### Bước 4 — Hiển thị bản nháp kết quả

Khi hoàn thành, thay giao diện tiến trình bằng **Plan Preview** có:

- Tên kế hoạch.
- Tóm tắt mục tiêu.
- Số task/subtask.
- Thời lượng hoặc khoảng lịch dự kiến.
- Những giả định quan trọng.
- Danh sách task theo thứ tự, priority, deadline, estimate, dependencies.
- Cảnh báo nếu khối lượng vượt quá thời hạn hoặc có thông tin chưa đủ.

### Bước 5 — Người dùng rà soát

Người dùng có thể:

- Sửa tên, nội dung, ngày, thứ tự, priority hoặc estimate.
- Chỉnh sửa subtask.
- Bỏ chọn task không muốn tạo.
- Thêm task thủ công.
- Xem/điều chỉnh phụ thuộc nếu có.
- Tạo lại toàn bộ bản nháp hoặc yêu cầu chỉnh từng phần.
- Chọn đích lưu và người phụ trách hợp lệ.

Các chỉnh sửa thủ công chưa được xác nhận **không được tự ý ghi đè** bởi lần đề xuất AI tiếp theo.

### Bước 6 — Xác nhận và tạo công việc

Nút chính: **“Create selected tasks”**; cạnh nút hiển thị số task sắp được tạo.

Trước khi ghi dữ liệu, kiểm tra:

- Người dùng có quyền tạo task trong nơi đã chọn.
- Task có tiêu đề hợp lệ.
- Deadline/estimate có định dạng và thứ tự thời gian hợp lệ.
- Phụ thuộc không tạo vòng lặp.
- Task tham chiếu tới người phụ trách/dự án có thật và được cấp quyền.
- Không tạo trùng do bấm nhiều lần.

Khi hoàn tất: thông báo “Created 8 tasks successfully”, cho phép **View Board** / **View Task List**. Nếu một phần không tạo được, chỉ rõ các item bị lỗi và cách xử lý; không thông báo thành công toàn bộ khi chỉ lưu được một phần.

---

## 5. AI PLANNING PROGRESS TIMELINE — HIỆU ỨNG “THINKING”

### 5.1. Tên gọi

Tên component/feature gợi ý: **AI Planning Progress Timeline**.  
Các khái niệm tham khảo: **Agent Execution Timeline**, **Workflow Progress Stepper**, **AI Activity Timeline**.

### 5.2. Ý đồ trải nghiệm

Giao diện không chỉ hiển thị spinner. Nó cho người dùng hiểu hệ thống đang ở đâu trong quá trình tạo kế hoạch, với cảm giác mượt, rõ ràng và không gây rối.

Một bước có thể ở trạng thái:

| Trạng thái | Ý nghĩa | Biểu hiện UI |
|---|---|---|
| `pending` | Chưa bắt đầu | Chữ xám, biểu tượng tròn rỗng |
| `active` | Đang xử lý | Icon chuyển động nhẹ, dòng mô tả trạng thái |
| `completed` | Hoàn thành thực tế | Dấu tick, màu xác nhận, dòng tóm tắt |
| `failed` | Bước gặp lỗi | Icon cảnh báo, thông báo và tùy chọn thử lại |
| `skipped` | Không áp dụng | Nhãn “Skipped”, không giả vờ đã xử lý |

### 5.3. Các giai đoạn đề xuất

| # | Tên hiển thị | Mục đích | Ví dụ mô tả |
|---|---|---|---|
| 1 | **Understanding your goal** | Hiểu bối cảnh, đầu ra mong muốn và giới hạn | “Reviewing scope and constraints” |
| 2 | **Breaking down the work** | Tạo task/subtask có đầu ra rõ | “Organizing actionable steps” |
| 3 | **Prioritizing tasks** | Gợi ý mức ưu tiên và thứ tự | “Identifying critical tasks” |
| 4 | **Planning the timeline** | Xem xét estimate, deadline, phụ thuộc | “Building a realistic schedule” |
| 5 | **Preparing your plan** | Kiểm tra tính nhất quán và hiển thị kết quả | “Finalizing your task preview” |

**Quy tắc bắt buộc về tính trung thực:** Chỉ đánh dấu một giai đoạn `completed` nếu ứng dụng thực sự đã hoàn thành công việc tương ứng. Nếu sản phẩm chỉ thực hiện **một lần xử lý AI duy nhất**, không được giả vờ từng bước đã diễn ra độc lập. Trong trường hợp đó, dùng trạng thái chung như **“Generating your plan”**, có thể kèm các nhãn mô tả đây là **những việc AI được yêu cầu cân nhắc** chứ không phải log các bước đã chạy. Timeline chi tiết chỉ xuất hiện khi hệ thống thật sự có các mốc xử lý để theo dõi.

Không hiển thị suy luận riêng tư hoặc chuỗi suy nghĩ nội bộ của AI. Chỉ hiện các **trạng thái công việc và tóm tắt có thể kiểm chứng**.

### 5.4. Quy tắc animation

- Khi bắt đầu: tiêu đề fade in, dòng trạng thái xuất hiện nhẹ nhàng.
- Bước đang xử lý: icon xoay/chuyển động vừa phải; không nhấp nháy liên tục.
- Chuyển bước: bước cũ đổi sang dấu tick, bước kế tiếp được làm nổi bật.
- Có thể hiển thị “2 of 5 steps” **nếu** 5 giai đoạn tồn tại thật.
- Không dùng phần trăm giả. Chỉ hiển thị % khi có cách đo tiến độ đáng tin cậy.
- Khi hoàn thành: chuyển nhẹ sang bản kế hoạch; **không bắt người dùng xem hết animation giả định**.
- Khi lâu hơn dự kiến: hiển thị trạng thái trung thực “Still preparing your plan…” cùng lựa chọn hủy/thử lại khi phù hợp.
- Tôn trọng tùy chọn giảm chuyển động của thiết bị/người dùng.

### 5.5. Nội dung trạng thái mẫu

```text
✦ Creating your task plan

✓ Understanding your goal
  Scope and constraints identified

✓ Breaking down the work
  8 tasks drafted

◌ Prioritizing tasks
  Reviewing urgency and dependencies…

○ Planning the timeline
○ Preparing your plan
```

Đây chỉ là ví dụ giao diện. Các số lượng và tick chỉ được hiển thị khi có dữ liệu thực tế.

### 5.6. Khi xảy ra sự cố

- **Hủy:** Dừng/từ bỏ tác vụ theo khả năng của hệ thống, không lưu task thật; thông báo rõ nếu hoạt động xử lý không thể dừng ngay.
- **Mất kết nối:** Cho phép khôi phục trạng thái hoặc kiểm tra kết quả đã tạo, tránh khởi chạy bản sao không cần thiết.
- **Lỗi AI:** Hiển thị lý do ở mức người dùng hiểu được, có nút Retry và giữ nguyên dữ liệu đầu vào.
- **Hết thời gian:** Không hiển thị “Done”; có trạng thái “Taking longer than expected”.
- **Bản nháp đã tạo nhưng chưa lưu:** Phân biệt rõ **Plan generated** với **Tasks created**.

---

## 6. THIẾT KẾ GIAO DIỆN VÀ CẤU TRÚC MÀN HÌNH

### 6.1. Màn hình nhập mục tiêu

**Bố cục gợi ý:** Một dialog rộng hoặc trang riêng, phong cách SaaS tinh giản.

- Header: biểu tượng AI, tiêu đề, mô tả ngắn.
- Khu vực trung tâm: ô nhập mục tiêu lớn, hỗ trợ nhập nhiều dòng.
- Bên dưới: chips ví dụ (*Build a website*, *Prepare an event*, *Study plan*).
- Nhóm tùy chọn: thời lượng, workspace, mức độ chi tiết.
- Footer: nút tạo kế hoạch + ghi chú “You can review everything before creating tasks.”

Ưu tiên **rõ ràng, ít thao tác**, không cần giao diện chatbot toàn màn hình.

### 6.2. Màn hình tiến trình

- Giữ nguyên tên mục tiêu ở trên cùng để bảo toàn ngữ cảnh.
- Timeline ở trung tâm, tối đa 5 bước, không cuộn quá dài.
- Không lạm dụng gradient/glow gây khó đọc.
- Có trạng thái Cancel/Close có giải thích tác động.
- Nếu xử lý xong nhanh, hiện kết quả ngay thay vì kéo dài animation.

### 6.3. Màn hình xem trước kế hoạch

**A. Summary panel**

- Plan title và goal summary.
- Total tasks / subtasks.
- Estimated workload / target date nếu có.
- Warning badge cho deadline có nguy cơ không khả thi.

**B. Task list**

Mỗi task có:

- Checkbox chọn tạo.
- Thứ tự ưu tiên.
- Tên và mô tả ngắn.
- Priority badge.
- Ước lượng thời gian.
- Due date nếu hợp lệ.
- Số subtask.
- Nhãn dependency hoặc assignee nếu có.
- Menu chỉnh sửa/bỏ task.

**C. Task detail drawer**

Khi click task, hiển thị chi tiết, subtasks, tiêu chí hoàn thành, phụ thuộc và giả định liên quan.

**D. Footer cố định**

- “Back to edit goal”.
- “Regenerate” (cảnh báo nếu sắp thay thế bản nháp đã chỉnh tay).
- “Create selected tasks (N)”.

### 6.4. Microcopy nên dùng

| Vị trí | Gợi ý nội dung |
|---|---|
| CTA chính | `Plan with AI` |
| Bắt đầu | `Generate my plan` |
| Trạng thái | `Preparing your plan...` |
| Kết quả | `Your plan is ready to review` |
| Lưu | `Create selected tasks` |
| Sau khi lưu | `Tasks created successfully` |
| AI thiếu dữ liệu | `I need a little more context to make this plan useful.` |
| Cảnh báo ước lượng | `Timeline and effort are suggestions. Review before saving.` |

---

## 7. QUY TẮC TẠO KẾ HOẠCH CỦA AI

### 7.1. Cách phân rã công việc

- Mỗi task phải là một đơn vị công việc **có thể hành động và kiểm chứng**.
- Tiêu đề task nên bắt đầu bằng động từ: “Thiết kế”, “Xây dựng”, “Kiểm thử”, “Chuẩn bị”…
- Tránh task chung chung như “Làm dự án” hoặc “Hoàn thiện mọi thứ”.
- Chỉ tạo subtask khi công việc thực sự cần chia nhỏ.
- Cân bằng: không trả quá ít task để kế hoạch trở nên vô dụng, cũng không bẻ nhỏ thành hàng chục mục vụn vặt.
- Có thể giới hạn mềm theo detail level; nếu phạm vi quá lớn, chia theo giai đoạn hoặc yêu cầu thu hẹp.

### 7.2. Priority

- **High:** Chặn các bước khác, tác động lớn hoặc sát deadline.
- **Medium:** Quan trọng nhưng có thể sắp sau các bước cốt lõi.
- **Low:** Bổ sung, cải tiến hoặc không ảnh hưởng trực tiếp đến mục tiêu tối thiểu.

Priority là **gợi ý có ngữ cảnh**, không phải kết luận tuyệt đối. Không tự gán tất cả task thành High.

### 7.3. Timeline và ước lượng

- Chỉ đưa ngày tuyệt đối nếu người dùng cung cấp hoặc hệ thống có mốc thời gian được xác định rõ.
- Nếu người dùng chỉ nêu “14 ngày” mà không nêu ngày bắt đầu, nên dùng **Day 1–Day 14** thay vì tự chọn một ngày cụ thể.
- Estimate nên biểu thị dưới dạng khoảng hoặc mức xấp xỉ khi thiếu dữ liệu.
- Dependencies phải đảm bảo thứ tự hợp lý; công việc phụ thuộc không nên được lên lịch trước công việc tiền nhiệm nếu quan hệ là bắt buộc.
- Nếu deadline khó khả thi, AI phải **nêu rủi ro/giảm phạm vi đề xuất**, không cố ép cho đủ số ngày.

### 7.4. Phân công thành viên

- Chỉ gán cho người có thật và thuộc phạm vi cho phép.
- Nếu biết vai trò mà chưa biết người: đề xuất vai trò, để trống assignee.
- Nếu chỉ biết “team 2 người”: không được tự tạo tên hoặc giả định năng lực/công suất.
- Không tự giao việc khi chưa được duyệt.

### 7.5. Ngôn ngữ

Mặc định đáp ứng cùng ngôn ngữ với mục tiêu mà người dùng nhập. Thuật ngữ chuyên ngành có thể giữ nguyên khi phổ biến. Các title, mô tả và trạng thái cần thống nhất ngôn ngữ trong cùng kế hoạch.

---

## 8. ĐỊNH DẠNG THÔNG TIN CỦA MỘT BẢN KẾ HOẠCH

Đây là mô hình **khái niệm sản phẩm**, không quy định database, API hay framework.

### Kế hoạch

| Thuộc tính | Ý nghĩa |
|---|---|
| `planTitle` | Tên ngắn gọn, dễ hiểu |
| `goalSummary` | Mục tiêu đã được diễn giải |
| `duration` | Khoảng thời gian dự kiến, nếu có |
| `assumptions` | Các giả định AI sử dụng |
| `warnings` | Rủi ro hoặc điểm cần lưu ý |
| `tasks` | Danh sách task được đề xuất |

### Task đề xuất

| Thuộc tính | Ý nghĩa |
|---|---|
| `temporaryId` | Định danh tạm trong bản nháp |
| `title` | Tên task hành động cụ thể |
| `description` | Mô tả công việc |
| `completionCriteria` | Điều kiện xác nhận hoàn thành |
| `priority` | High / Medium / Low |
| `priorityReason` | Giải thích ngắn về thứ tự ưu tiên |
| `estimate` | Ước lượng công sức; có thể không xác định |
| `suggestedStart` | Mốc bắt đầu tương đối hoặc tuyệt đối |
| `suggestedDue` | Mốc hoàn thành tương đối hoặc tuyệt đối |
| `dependencies` | Các `temporaryId` tiền nhiệm |
| `subtasks` | Danh sách bước nhỏ |
| `suggestedRole` | Vai trò gợi ý, nếu có |
| `selected` | Người dùng có chọn tạo task này không |

**Quy tắc:** Giá trị không đủ căn cứ có thể để trống hoặc đánh dấu cần xác nhận; không tự biến dữ liệu dự đoán thành dữ liệu chắc chắn.

---

## 9. VÍ DỤ ĐẦU VÀO — ĐẦU RA

### Mục tiêu người dùng

> “Xây dựng website bán hàng MVP trong 14 ngày. Có đăng nhập, quản lý sản phẩm, giỏ hàng, thanh toán và deploy. Nhóm có 2 người. Ưu tiên tính năng chạy ổn định.”

### Tóm tắt AI đề xuất

**Tên kế hoạch:** E-commerce MVP Launch  
**Thời lượng:** 14 ngày tương đối (chưa xác định ngày bắt đầu)  
**Giả định:** Thanh toán ở mức tích hợp cơ bản/sandbox; phạm vi thiết kế tối giản; chưa biết kinh nghiệm và lịch rảnh của hai thành viên.  
**Cảnh báo:** Mốc 14 ngày có thể quá ngắn nếu cần thanh toán production với nhiều yêu cầu kiểm thử/bảo mật.

| STT | Task chính | Priority | Thời gian gợi ý | Phụ thuộc |
|---|---|---|---|---|
| 1 | Xác định phạm vi MVP và luồng người dùng | High | Ngày 1 | — |
| 2 | Thiết kế dữ liệu và cấu trúc nghiệp vụ | High | Ngày 1–2 | 1 |
| 3 | Xây dựng đăng nhập và quản lý phiên | High | Ngày 3–4 | 2 |
| 4 | Xây dựng quản lý sản phẩm | High | Ngày 4–6 | 2 |
| 5 | Xây dựng giỏ hàng và đặt hàng | High | Ngày 7–9 | 3, 4 |
| 6 | Tích hợp thanh toán theo phạm vi MVP | High | Ngày 9–11 | 5 |
| 7 | Kiểm thử luồng mua hàng và xử lý lỗi | High | Ngày 11–13 | 3, 4, 5, 6 |
| 8 | Triển khai và kiểm tra sau triển khai | High | Ngày 13–14 | 7 |

**Ví dụ subtask của “Xây dựng giỏ hàng và đặt hàng”:**

- Tạo/thay đổi/xóa sản phẩm khỏi giỏ hàng.
- Kiểm tra số lượng và trạng thái sản phẩm.
- Tính tổng giá trị đơn hàng.
- Tạo đơn hàng và xác nhận trạng thái.
- Kiểm thử các tình huống giỏ hàng rỗng, sản phẩm hết hàng, dữ liệu không hợp lệ.

**Tiêu chí hoàn thành:** Người dùng có thể chọn sản phẩm, đặt hàng thử nghiệm và xem kết quả hợp lệ trong phạm vi MVP.

**Lưu ý:** Bảng trên là ví dụ sản phẩm, không phải cam kết đủ sức hoàn thành đúng 14 ngày. Khi triển khai thực tế cần cân chỉnh theo năng lực và công suất của nhóm.

---

## 10. LOGIC TƯƠNG TÁC SAU KHI AI TẠO KẾ HOẠCH

### Chỉnh sửa trực tiếp

Người dùng có toàn quyền chỉnh các nội dung của bản nháp trước khi tạo task. Mọi chỉnh sửa phải được phản ánh ngay trong bản xem trước.

### Tạo lại toàn bộ

Nếu người dùng nhấn **Regenerate**, hệ thống cần cảnh báo nếu bản nháp hiện tại có sửa đổi chưa lưu:

> “Generating a new plan may replace your edits. Continue?”

Nếu người dùng không xác nhận, giữ nguyên bản nháp.

### Chỉnh từng phần bằng AI (nâng cao)

Ví dụ các thao tác:

- “Make the plan achievable in 7 days.”
- “Break task 3 into smaller steps.”
- “Prioritize testing over visual polish.”
- “Remove payment integration from MVP.”

Khi điều chỉnh, chỉ những phần được chọn mới thay đổi; các phần người dùng đã khóa/chỉnh tay được giữ nguyên hoặc yêu cầu xác nhận.

### Chọn task để lưu

- Mặc định có thể chọn tất cả các task hợp lệ.
- Người dùng bỏ chọn bất kỳ task nào.
- Nếu bỏ task mà task khác phụ thuộc vào nó, hiển thị cảnh báo và cho phép sửa dependency trước khi lưu.
- Nếu không còn task được chọn, nút tạo phải bị vô hiệu hóa.

### Chống tạo trùng

Nếu một yêu cầu tạo task đã thành công, nhấn nút lần nữa không được âm thầm tạo thêm bản sao. Khi người dùng muốn tạo lại, phải đưa ra hành động có chủ đích.

---

## 11. TRẠNG THÁI SẢN PHẨM

Luồng trạng thái tổng quát:

```text
Idle
  ↓
Input Ready
  ↓
Validating Input
  ├─ Needs Clarification ──→ Input Ready
  └─ Valid
       ↓
    Generating
       ├─ Cancelled
       ├─ Failed ──→ Retry / Edit Input
       └─ Draft Ready
            ↓
         Reviewing Draft
            ├─ Edit / Regenerate
            └─ Confirm Selected Tasks
                 ↓
              Creating Tasks
                 ├─ Failed / Partially Created
                 └─ Created Successfully
```

**Phân biệt cốt lõi:** `Draft Ready` **khác** `Created Successfully`.

---

## 12. TRƯỜNG HỢP ĐẶC BIỆT VÀ XỬ LÝ LỖI

| Tình huống | Hành vi mong muốn |
|---|---|
| Người dùng bỏ trống mục tiêu | Không gửi yêu cầu, hiển thị hướng dẫn nhập |
| Mục tiêu quá mơ hồ | Xin làm rõ hoặc cho phép tiếp tục với giả định minh bạch |
| Mục tiêu quá lớn | Đề nghị chia thành giai đoạn/giới hạn phạm vi |
| Deadline quá ngắn | Cảnh báo và gợi ý giảm scope hoặc điều chỉnh mốc |
| Không có thông tin team | Không bịa thành viên hoặc phân công |
| Kế hoạch sinh ra thiếu thông tin | Cho sửa hoặc yêu cầu tạo lại, không lưu dữ liệu hỏng |
| Dependency bị vòng lặp | Chặn lưu và yêu cầu sửa quan hệ |
| AI trả task trùng lặp | Gộp/gợi ý loại trùng trước khi người dùng xác nhận |
| Task có ngày kết thúc trước ngày bắt đầu | Hiển thị lỗi và cho sửa |
| Mất mạng giữa quá trình | Giữ input, hiển thị trạng thái đúng, tránh lưu trùng |
| Người dùng đóng cửa sổ | Cảnh báo mất thay đổi nếu có bản nháp chưa xác nhận |
| Người dùng không có quyền trong project | Chặn tạo, cho chọn nơi được cấp quyền |
| Kết quả không thể tạo task | Giải thích, cho sửa hoặc tạo lại |
| Tạo được một phần | Báo rõ item nào đã tạo, item nào chưa; cho xử lý phần còn lại |
| Người dùng nhập dữ liệu nhạy cảm | Hạn chế thu thập, thông báo về dữ liệu được gửi cho AI theo chính sách sản phẩm |

---

## 13. QUY TẮC CHẤT LƯỢNG VÀ AN TOÀN SẢN PHẨM

1. Nội dung mục tiêu là **dữ liệu người dùng**, không được coi là lệnh để bỏ qua các quy tắc an toàn hoặc can thiệp hệ thống.
2. Không hiển thị chain-of-thought nội bộ; chỉ hiển thị trạng thái thao tác và giải thích tóm tắt ở mức sản phẩm.
3. Không đọc hoặc tiết lộ task/project của người khác khi người dùng không có quyền.
4. Không tự ý kích hoạt hành động làm thay đổi dữ liệu khi chưa xác nhận.
5. Không hứa rằng AI chắc chắn dự báo đúng deadline hoặc mức độ khó.
6. Không mặc định đưa thông tin nhạy cảm của nhóm/dự án vào ngữ cảnh AI nếu không cần thiết.
7. Thông báo rõ khi AI không thể đưa ra kết quả tin cậy.
8. Giảm thiểu phát sinh chi phí và tránh spam thao tác tạo kế hoạch; khi cần, giới hạn số lần tạo lại một cách minh bạch.
9. Các task được tạo phải có thể chỉnh sửa bình thường như task thủ công; không khóa người dùng vào kết quả AI.
10. AI Smart chỉ dùng Gemini. Mỗi tài khoản tự cung cấp tối đa một Gemini API key và chọn model; không có provider key khác hoặc key dùng chung toàn hệ thống. Server-side encryption key là secret vận hành riêng, không phải key AI của người dùng.

---

## 14. TIÊU CHÍ NGHIỆM THU (ACCEPTANCE CRITERIA)

### AC-01 — Tạo kế hoạch từ mục tiêu

**Given:** Người dùng nhập mục tiêu hợp lệ.  
**When:** Người dùng chọn Generate plan.  
**Then:** Hệ thống tạo được bản kế hoạch nháp gồm những task có ý nghĩa, không tự lưu task thật.

### AC-02 — Hiển thị tiến trình trung thực

**Given:** Quá trình tạo kế hoạch đang diễn ra.  
**When:** Giao diện hiển thị status/timeline.  
**Then:** Các trạng thái được hiển thị đúng với các mốc xử lý thực; không xuất hiện bước “đã hoàn thành” khi chưa có căn cứ.

### AC-03 — Xem trước và chỉnh sửa

**Given:** Bản kế hoạch nháp đã sẵn sàng.  
**When:** Người dùng sửa task hoặc bỏ chọn task.  
**Then:** Nội dung và số lượng task sắp tạo cập nhật chính xác.

### AC-04 — Xác nhận trước khi ghi dữ liệu

**Given:** Có các task hợp lệ được chọn.  
**When:** Người dùng chưa bấm xác nhận.  
**Then:** Không có task mới nào xuất hiện trong dự án thực.

### AC-05 — Tạo task thành công

**Given:** Người dùng có quyền và đã chọn ít nhất một task hợp lệ.  
**When:** Người dùng bấm Create selected tasks.  
**Then:** Chỉ task được chọn được tạo; phản hồi chỉ ra số lượng tạo thực tế, cho phép truy cập từ Board/List.

### AC-06 — Không tạo trùng khi thao tác lặp

**Given:** Lần xác nhận tạo task vừa thành công hoặc đang xử lý.  
**When:** Người dùng nhấn lại hoặc gửi lại cùng thao tác.  
**Then:** Không phát sinh các bản sao ngoài ý muốn.

### AC-07 — Xử lý lỗi có thể phục hồi

**Given:** Tạo kế hoạch thất bại/mất kết nối/hết thời gian.  
**When:** Hệ thống nhận diện sự cố.  
**Then:** Có thông báo rõ, giữ input khi khả thi và cho Retry hoặc chỉnh sửa; không báo thành công sai.

### AC-08 — Không bịa dữ liệu dự án

**Given:** Người dùng không cung cấp ngày bắt đầu hoặc danh sách thành viên.  
**When:** AI lập kế hoạch.  
**Then:** Không bịa ngày cụ thể/tên người; hiển thị mốc tương đối hoặc trường cần xác nhận.

### AC-09 — Kiểm tra phụ thuộc

**Given:** Người dùng bỏ chọn task tiền nhiệm hoặc thay đổi dependency.  
**When:** Người dùng xác nhận lưu.  
**Then:** Hệ thống cảnh báo/không cho lưu phụ thuộc không hợp lệ.

### AC-10 — Kết quả có thể kiểm chứng

**Given:** AI đề xuất một task.  
**When:** Người dùng mở chi tiết.  
**Then:** Task có mô tả và tiêu chí hoàn thành đủ rõ để dùng thực tế.

---

## 15. KỊCH BẢN DEMO CHO NGƯỜI TUYỂN DỤNG

**Tổng thể:** Giới thiệu chức năng như một trợ lý tạo kế hoạch, không phải chatbot cho có AI.

1. Mở một Project trống, nhấn **Plan with AI**.
2. Nhập mục tiêu “Xây dựng website bán hàng MVP trong 14 ngày”.
3. Nhấn **Generate my plan**.
4. Cho thấy trạng thái xử lý/tiến trình đang diễn ra (đúng với công việc thực tế).
5. Hiển thị kết quả gồm task/subtask, priority, deadline tương đối, dependency.
6. Chỉnh sửa một task, bỏ chọn một task không cần thiết.
7. Nhấn **Create selected tasks**.
8. Điều hướng tới Kanban/Task List để chứng minh dữ liệu đã được tạo thật.
9. Thay đổi trạng thái một task nhằm chứng minh các task được AI tạo hoạt động giống task thông thường.

**Thông điệp demo:** “AI helps users turn vague goals into a reviewable plan, and only writes approved tasks to the workspace.”

---

## 16. CHECKLIST TRIỂN KHAI THEO SẢN PHẨM

### Phase 1 — MVP

- [ ] Nút truy cập AI Planner ở vị trí dễ thấy.
- [ ] Form nhập mục tiêu, thời gian, mức độ chi tiết.
- [ ] Validation đầu vào và thông báo lỗi rõ ràng.
- [ ] Tạo bản nháp kế hoạch có cấu trúc.
- [ ] Giao diện trạng thái loading/processing trung thực.
- [ ] Hiển thị bản xem trước với task và subtask.
- [ ] Chỉnh sửa các trường chính ngay tại bản nháp.
- [ ] Chọn/bỏ chọn task trước khi tạo.
- [ ] Xác nhận mới ghi thành task thật.
- [ ] Điều hướng được tới Board/List sau khi tạo.
- [ ] Xử lý hủy, lỗi, retry và chống tạo trùng.

### Phase 2 — Nâng cao

- [ ] Timeline 5 bước có sự kiện/mốc xử lý thật.
- [ ] Gợi ý dependency nâng cao và cảnh báo schedule conflict.
- [ ] Chỉnh sửa kế hoạch bằng ngôn ngữ tự nhiên.
- [ ] Đọc bối cảnh Project hiện có theo quyền của người dùng.
- [ ] Đề xuất phân công người thật có kiểm tra quyền.
- [ ] Lịch sử và so sánh các bản nháp.
- [ ] Gợi ý tối ưu kế hoạch khi thay đổi thời hạn.

---

## 17. ĐỊNH HƯỚNG THẨM MỸ

**Phong cách:** Professional SaaS, minimal, dễ đọc, tạo cảm giác tin cậy.

- Giao diện chính giữ nguyên design system của ứng dụng.
- Màu nhấn AI chỉ sử dụng ở biểu tượng, nút Generate và trạng thái đang xử lý.
- Không biến màn hình thành “hộp thoại chatbot” nếu trải nghiệm thực tế là tạo kế hoạch có cấu trúc.
- Animation nhẹ, nhanh, có chủ đích.
- Đảm bảo khả năng dùng bằng bàn phím, thông báo trạng thái tiếp cận được và hỗ trợ reduced motion.
- Khi kết quả đã có, **thông tin và khả năng chỉnh sửa** quan trọng hơn animation.

---

## 18. QUYẾT ĐỊNH CUỐI CHO BẢN ĐẦU

**Tên tính năng:** AI Smart Task Planner  
**Tên UI tiến trình:** AI Planning Progress Timeline  
**Mô hình tương tác:** Goal → Draft Plan → Review/Edit → Confirm → Real Tasks  
**Cam kết sản phẩm:** Không ghi dữ liệu thật nếu chưa được xác nhận.  
**Phạm vi tối thiểu:** Tạo task/subtask, gợi ý ưu tiên/thời gian, xem trước/chỉnh sửa, lưu các task được chọn.  
**Nguyên tắc tiến trình:** Hiển thị trạng thái có thật; không mô phỏng suy nghĩ nội bộ của AI hay các bước giả.

> **Một câu mô tả dùng trong README hoặc phần trình bày:**  
> “AI Smart Task Planner transforms natural-language goals into structured, editable task plans with suggested priorities, timelines and dependencies. Users review and approve the plan before tasks are created.”

---

*Tài liệu này mô tả yêu cầu sản phẩm và trải nghiệm người dùng, không ràng buộc vào bất kỳ framework, kiến trúc, thư viện, mô hình AI, giao thức streaming hay cách tổ chức repository nào.*
