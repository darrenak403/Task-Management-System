// Demo content for the seed script. Everything here is made up; the text is Vietnamese because the demo audience is.

export type UserKey = 'anh' | 'khanh';
export type WorkspaceKey = 'studio' | 'cafe';
export type TeamKey = 'backend' | 'frontend' | 'operations';

// Two people, each running a workspace of their own. Neither can see the other's workspace until invited into it.
export const users: Record<UserKey, { id: string; email: string; displayName: string }> = {
  anh: { id: '10000000-0000-4000-8000-000000000001', email: 'anh@gmail.com', displayName: 'Nguyễn Minh Anh' },
  khanh: { id: '10000000-0000-4000-8000-000000000003', email: 'khanh@gmail.com', displayName: 'Đặng Gia Khánh' },
};

export const workspaces: Record<WorkspaceKey, { id: string; name: string; owner: UserKey }> = {
  studio: { id: '20000000-0000-4000-8000-000000000001', name: 'AIM Studio', owner: 'anh' },
  cafe: { id: '20000000-0000-4000-8000-000000000002', name: 'Quán Cà Phê Sáng', owner: 'khanh' },
};

export type SeedTask = {
  title: string;
  description: string;
  status: 'TODO' | 'IN_PROGRESS' | 'DONE';
  priority: 'LOW' | 'MEDIUM' | 'HIGH';
  creator: UserKey;
  assignee: UserKey | null;
  /** Planned start and deadline, in days from the day the seed runs. */
  start: number | null;
  due: number | null;
  /** Lowest and highest estimate, in minutes. */
  estimate: [number, number] | null;
  completionCriteria: string;
  priorityReason: string;
  checklist?: Array<[title: string, isCompleted: boolean]>;
  /** Positions, in the same team's list, of the tasks that must be finished first. */
  prerequisites?: number[];
};

export type SeedTeam = { id: string; workspace: WorkspaceKey; name: string; taskIdPrefix: string; members: UserKey[]; tasks: SeedTask[] };

const backendTasks: SeedTask[] = [
  {
    title: 'Thiết kế schema đơn hàng và thanh toán',
    description: 'Mô hình hoá bảng đơn hàng, dòng đơn hàng và giao dịch thanh toán cho AIM Shop, kèm khoá ngoại và ràng buộc.',
    status: 'DONE', priority: 'HIGH', creator: 'anh', assignee: 'anh', start: -10, due: -7, estimate: [240, 480],
    completionCriteria: 'Sơ đồ ERD được cả nhóm duyệt và migration chạy sạch trên database trống.',
    priorityReason: 'Mọi API về đơn hàng đều phụ thuộc vào schema này.',
    checklist: [['Vẽ sơ đồ ERD', true], ['Viết migration', true], ['Cả nhóm review', true]],
  },
  {
    title: 'Xây API đăng ký và đăng nhập bằng cookie phiên',
    description: 'Đăng ký, đăng nhập, đăng xuất. Mật khẩu băm bằng Argon2id, phiên lưu trong cookie HttpOnly.',
    status: 'DONE', priority: 'HIGH', creator: 'anh', assignee: 'anh', start: -9, due: -6, estimate: [240, 360],
    completionCriteria: 'Đăng nhập sai trả 401, đăng nhập đúng đặt cookie và gọi được API cần xác thực.',
    priorityReason: 'Không có đăng nhập thì không kiểm thử được phần còn lại.',
  },
  {
    title: 'Thiết lập CI chạy lint, typecheck và test',
    description: 'Mỗi pull request phải chạy đủ lint, typecheck, test và build trước khi được merge.',
    status: 'DONE', priority: 'MEDIUM', creator: 'anh', assignee: 'anh', start: -8, due: -6, estimate: [120, 180],
    completionCriteria: 'Pull request có lỗi lint hoặc test đỏ bị chặn merge.',
    priorityReason: 'Bắt lỗi sớm, đỡ tốn công review.',
  },
  {
    title: 'API danh mục và sản phẩm có phân trang',
    description: 'Liệt kê sản phẩm theo danh mục, lọc theo giá và từ khoá, phân trang theo trang và kích thước trang.',
    status: 'DONE', priority: 'MEDIUM', creator: 'anh', assignee: 'anh', start: -7, due: -4, estimate: [180, 300],
    completionCriteria: 'Trang danh sách của Frontend lấy được dữ liệu thật, có tổng số bản ghi.',
    priorityReason: 'Frontend đang chờ để ghép trang danh sách sản phẩm.',
    prerequisites: [0],
  },
  {
    title: 'Viết dữ liệu mẫu cho môi trường phát triển',
    description: 'Tạo sẵn danh mục, sản phẩm và vài tài khoản để cả nhóm chạy thử mà không phải nhập tay.',
    status: 'DONE', priority: 'LOW', creator: 'anh', assignee: 'anh', start: -6, due: -4, estimate: [60, 120],
    completionCriteria: 'Chạy lại lệnh seed nhiều lần không sinh bản ghi trùng.',
    priorityReason: 'Tiện cho việc phát triển, không chặn ai.',
    prerequisites: [0],
  },
  {
    title: 'API giỏ hàng',
    description: 'Thêm, sửa số lượng, xoá sản phẩm trong giỏ. Giỏ hàng gắn với tài khoản đang đăng nhập.',
    status: 'DONE', priority: 'HIGH', creator: 'anh', assignee: 'anh', start: -5, due: -2, estimate: [240, 360],
    completionCriteria: 'Không thêm được số lượng vượt quá tồn kho; tổng tiền tính đúng.',
    priorityReason: 'Là bước ngay trước thanh toán trong luồng mua hàng.',
    checklist: [['Thêm sản phẩm vào giỏ', true], ['Cập nhật số lượng', true], ['Xoá khỏi giỏ', true], ['Tính tổng tiền', true]],
    prerequisites: [3],
  },
  {
    title: 'Tích hợp cổng thanh toán VNPay (sandbox)',
    description: 'Tạo liên kết thanh toán, chuyển hướng khách sang VNPay và nhận kết quả trả về.',
    status: 'IN_PROGRESS', priority: 'HIGH', creator: 'anh', assignee: 'anh', start: -3, due: -1, estimate: [480, 720],
    completionCriteria: 'Thanh toán thử trên sandbox thành công và đơn hàng chuyển sang trạng thái đã thanh toán.',
    priorityReason: 'Đã trễ hạn và đang chặn webhook, hoàn tiền, kiểm thử thanh toán.',
    checklist: [['Đăng ký tài khoản sandbox', true], ['Tạo liên kết thanh toán', true], ['Kiểm tra chữ ký trả về', false], ['Xử lý khách huỷ giữa chừng', false]],
    prerequisites: [0, 5],
  },
  {
    title: 'Xử lý webhook xác nhận thanh toán',
    description: 'Nhận thông báo từ VNPay, kiểm tra chữ ký và cập nhật đơn hàng. Một thông báo gửi lặp không được xử lý hai lần.',
    status: 'IN_PROGRESS', priority: 'HIGH', creator: 'anh', assignee: 'anh', start: -1, due: 0, estimate: [240, 360],
    completionCriteria: 'Gửi cùng một webhook hai lần chỉ ghi nhận một giao dịch.',
    priorityReason: 'Hạn hôm nay; thiếu nó thì đơn đã trả tiền vẫn hiện chưa thanh toán.',
    checklist: [['Kiểm tra chữ ký', true], ['Chống xử lý lặp', false], ['Ghi log giao dịch', false]],
    prerequisites: [6],
  },
  {
    title: 'API tạo đơn hàng và trừ tồn kho trong một transaction',
    description: 'Tạo đơn từ giỏ hàng, trừ tồn kho và xoá giỏ. Một bước lỗi thì hoàn tác toàn bộ.',
    status: 'IN_PROGRESS', priority: 'HIGH', creator: 'anh', assignee: 'anh', start: -2, due: 1, estimate: [300, 480],
    completionCriteria: 'Đặt hàng thất bại không làm thay đổi tồn kho hay giỏ hàng.',
    priorityReason: 'Là lõi của luồng mua hàng, nhiều việc khác đang chờ.',
    prerequisites: [5],
  },
  {
    title: 'Giới hạn tần suất cho đăng nhập và đăng ký',
    description: 'Giới hạn số lần thử theo địa chỉ IP và theo email, trả mã 429 kèm thời gian chờ.',
    status: 'IN_PROGRESS', priority: 'MEDIUM', creator: 'anh', assignee: 'anh', start: 0, due: 2, estimate: [120, 240],
    completionCriteria: 'Lần thử thứ 11 trong một phút từ cùng một IP bị từ chối.',
    priorityReason: 'Cần có trước khi mở cho người dùng thật.',
    prerequisites: [1],
  },
  {
    title: 'Gửi email xác nhận đơn hàng',
    description: 'Sau khi đặt hàng thành công, gửi email có mã đơn, danh sách sản phẩm và tổng tiền.',
    status: 'TODO', priority: 'MEDIUM', creator: 'anh', assignee: null, start: 1, due: 3, estimate: [180, 300],
    completionCriteria: 'Email đến hộp thư thử trong vòng một phút và hiển thị đúng trên điện thoại.',
    priorityReason: 'Khách cần bằng chứng đã đặt hàng, nhưng không chặn việc thanh toán.',
    prerequisites: [8],
  },
  {
    title: 'API mã giảm giá',
    description: 'Áp mã giảm theo phần trăm hoặc số tiền cố định, có hạn dùng và số lượt tối đa.',
    status: 'TODO', priority: 'MEDIUM', creator: 'anh', assignee: 'anh', start: 2, due: 5, estimate: [240, 420],
    completionCriteria: 'Mã hết hạn hoặc hết lượt bị từ chối kèm lý do rõ ràng.',
    priorityReason: 'Phòng kinh doanh cần cho đợt khuyến mãi cuối tháng.',
    prerequisites: [8],
  },
  {
    title: 'Tính phí vận chuyển theo tỉnh thành',
    description: 'Bảng phí theo vùng và theo cân nặng. Miễn phí vận chuyển cho đơn từ 500.000 đồng.',
    status: 'TODO', priority: 'MEDIUM', creator: 'anh', assignee: null, start: 2, due: 4, estimate: [180, 240],
    completionCriteria: 'Phí hiển thị ở trang thanh toán khớp với bảng phí đã duyệt.',
    priorityReason: 'Trang thanh toán cần con số này để tính tổng tiền.',
  },
  {
    title: 'API lịch sử đơn hàng của khách',
    description: 'Khách xem lại các đơn đã đặt, lọc theo trạng thái và xem chi tiết từng đơn.',
    status: 'TODO', priority: 'LOW', creator: 'anh', assignee: null, start: 3, due: 6, estimate: [120, 240],
    completionCriteria: 'Khách chỉ thấy đơn của chính mình.',
    priorityReason: 'Hữu ích nhưng chưa cần cho bản phát hành đầu.',
    prerequisites: [8],
  },
  {
    title: 'Hoàn tiền khi huỷ đơn đã thanh toán',
    description: 'Gọi API hoàn tiền của VNPay khi đơn bị huỷ, lưu trạng thái hoàn tiền và cộng lại tồn kho.',
    status: 'TODO', priority: 'HIGH', creator: 'anh', assignee: 'anh', start: 3, due: 7, estimate: [360, 600],
    completionCriteria: 'Huỷ đơn trên sandbox thì tiền được hoàn và tồn kho được cộng lại.',
    priorityReason: 'Liên quan trực tiếp đến tiền của khách.',
    prerequisites: [7],
  },
  {
    title: 'Ghi log có mã truy vết cho mọi request',
    description: 'Mỗi request có một mã riêng, xuất hiện trong mọi dòng log và trong phản hồi lỗi.',
    status: 'TODO', priority: 'LOW', creator: 'anh', assignee: null, start: null, due: null, estimate: [90, 180],
    completionCriteria: 'Từ mã trong một phản hồi lỗi tìm ra được toàn bộ log của request đó.',
    priorityReason: 'Giúp điều tra lỗi nhanh hơn, làm khi rảnh.',
  },
  {
    title: 'Sửa lỗi tồn kho âm khi hai người đặt cùng lúc',
    description: 'Hai đơn đặt cùng một sản phẩm cuối cùng đều thành công, làm tồn kho xuống âm.',
    status: 'TODO', priority: 'HIGH', creator: 'anh', assignee: null, start: 0, due: 0, estimate: [120, 240],
    completionCriteria: 'Có test chạy hai đơn song song: chỉ một đơn thành công, tồn kho không âm.',
    priorityReason: 'Lỗi dữ liệu nghiêm trọng, cần sửa trong hôm nay.',
    checklist: [['Viết test tái hiện lỗi', false], ['Khoá dòng tồn kho khi trừ', false]],
  },
  {
    title: 'Tối ưu truy vấn danh sách sản phẩm',
    description: 'Trang danh sách chậm khi có hơn 10.000 sản phẩm. Xem kế hoạch truy vấn và thêm index phù hợp.',
    status: 'TODO', priority: 'MEDIUM', creator: 'anh', assignee: 'anh', start: 4, due: 6, estimate: [120, 300],
    completionCriteria: 'Thời gian phản hồi p95 của trang danh sách dưới 300 ms với dữ liệu thử.',
    priorityReason: 'Ảnh hưởng trải nghiệm nhưng chưa gây lỗi.',
    prerequisites: [3],
  },
  {
    title: 'Sao lưu database hằng ngày',
    description: 'Tự động sao lưu mỗi đêm, giữ 7 bản gần nhất và thử khôi phục định kỳ.',
    status: 'TODO', priority: 'MEDIUM', creator: 'anh', assignee: 'anh', start: 5, due: 7, estimate: [180, 300],
    completionCriteria: 'Khôi phục thành công từ bản sao lưu của đêm trước sang một database khác.',
    priorityReason: 'Bắt buộc phải có trước khi nhận đơn hàng thật.',
  },
  {
    title: 'Viết tài liệu OpenAPI cho nhóm API đơn hàng',
    description: 'Mô tả request, response và các mã lỗi của API đơn hàng trên Swagger.',
    status: 'TODO', priority: 'LOW', creator: 'anh', assignee: null, start: null, due: 6, estimate: [60, 120],
    completionCriteria: 'Frontend sinh được kiểu dữ liệu từ tài liệu mà không phải sửa tay.',
    priorityReason: 'Giảm hỏi đáp qua lại giữa hai nhóm.',
  },
  {
    title: 'Kiểm thử tích hợp cho luồng thanh toán',
    description: 'Test từ tạo đơn, thanh toán, nhận webhook đến cập nhật trạng thái, chạy trên database thật.',
    status: 'TODO', priority: 'HIGH', creator: 'anh', assignee: 'anh', start: 1, due: 2, estimate: [240, 360],
    completionCriteria: 'Bộ test chạy trong CI và bao phủ cả trường hợp thanh toán thất bại.',
    priorityReason: 'Luồng liên quan đến tiền không thể chỉ kiểm thử bằng tay.',
    prerequisites: [7],
  },
  {
    title: 'Dọn phiên đăng nhập hết hạn theo lịch',
    description: 'Tác vụ nền xoá các phiên đã hết hạn để bảng phiên không phình to.',
    status: 'DONE', priority: 'LOW', creator: 'anh', assignee: 'anh', start: -4, due: -3, estimate: [60, 90],
    completionCriteria: 'Phiên hết hạn biến mất khỏi database sau lần chạy kế tiếp.',
    priorityReason: 'Việc dọn dẹp, không ảnh hưởng người dùng.',
    prerequisites: [1],
  },
  {
    title: 'Rà soát phân quyền theo workspace',
    description: 'Kiểm tra mọi API: người ngoài workspace không đọc hay sửa được dữ liệu, kể cả khi đoán đúng ID.',
    status: 'IN_PROGRESS', priority: 'HIGH', creator: 'anh', assignee: 'anh', start: -1, due: 1, estimate: [240, 480],
    completionCriteria: 'Có test cho từng API chứng minh tài khoản của workspace khác nhận mã 404.',
    priorityReason: 'Lộ dữ liệu giữa các khách hàng là rủi ro lớn nhất của hệ thống.',
    checklist: [['API sản phẩm', true], ['API giỏ hàng', true], ['API đơn hàng', false], ['API thanh toán', false]],
  },
  {
    title: 'Tìm hiểu hàng đợi cho tác vụ nền',
    description: 'So sánh vài lựa chọn hàng đợi cho việc gửi email và xử lý webhook, ghi lại ưu nhược điểm.',
    status: 'TODO', priority: 'LOW', creator: 'anh', assignee: null, start: null, due: null, estimate: null,
    completionCriteria: 'Có một trang ghi chú so sánh và một đề xuất cụ thể.',
    priorityReason: 'Chuẩn bị cho giai đoạn sau, chưa gấp.',
  },
];

const frontendTasks: SeedTask[] = [
  {
    title: 'Dựng khung giao diện và hệ màu thương hiệu',
    description: 'Bố cục chung, thanh điều hướng, hệ màu cam của AIM Shop và các thành phần cơ bản.',
    status: 'DONE', priority: 'HIGH', creator: 'anh', assignee: 'anh', start: -9, due: -7, estimate: [240, 360],
    completionCriteria: 'Các trang sau dùng lại được bố cục và thành phần chung mà không viết lại CSS.',
    priorityReason: 'Là nền cho mọi trang khác.',
  },
  {
    title: 'Trang đăng nhập và đăng ký',
    description: 'Form có kiểm tra dữ liệu, hiện lỗi từ API và chuyển hướng sau khi đăng nhập.',
    status: 'DONE', priority: 'HIGH', creator: 'anh', assignee: 'anh', start: -7, due: -5, estimate: [180, 300],
    completionCriteria: 'Đăng ký xong vào thẳng trang chủ; lỗi hiển thị ngay dưới ô nhập tương ứng.',
    priorityReason: 'Cửa vào của toàn bộ ứng dụng.',
    checklist: [['Form đăng nhập', true], ['Form đăng ký', true], ['Hiện lỗi từ API', true]],
    prerequisites: [0],
  },
  {
    title: 'Trang danh sách sản phẩm có lọc và phân trang',
    description: 'Lưới sản phẩm, lọc theo danh mục và khoảng giá, trạng thái lọc nằm trên URL.',
    status: 'DONE', priority: 'MEDIUM', creator: 'anh', assignee: 'anh', start: -6, due: -3, estimate: [240, 360],
    completionCriteria: 'Tải lại trang hoặc gửi liên kết cho người khác vẫn giữ nguyên bộ lọc.',
    priorityReason: 'Trang được xem nhiều nhất.',
    prerequisites: [0],
  },
  {
    title: 'Trang chi tiết sản phẩm',
    description: 'Ảnh, giá, mô tả, tồn kho và nút thêm vào giỏ.',
    status: 'DONE', priority: 'MEDIUM', creator: 'anh', assignee: 'anh', start: -4, due: -2, estimate: [180, 240],
    completionCriteria: 'Sản phẩm hết hàng thì nút thêm vào giỏ bị vô hiệu hoá kèm lời giải thích.',
    priorityReason: 'Cần có trước khi làm giỏ hàng.',
    prerequisites: [2],
  },
  {
    title: 'Giao diện giỏ hàng',
    description: 'Danh sách sản phẩm trong giỏ, đổi số lượng, xoá và hiện tổng tiền.',
    status: 'IN_PROGRESS', priority: 'HIGH', creator: 'anh', assignee: 'anh', start: -2, due: -1, estimate: [240, 360],
    completionCriteria: 'Đổi số lượng cập nhật tổng tiền ngay và vẫn đúng sau khi tải lại trang.',
    priorityReason: 'Đã trễ hạn và đang chặn trang thanh toán.',
    checklist: [['Danh sách sản phẩm', true], ['Đổi số lượng', true], ['Xoá sản phẩm', false], ['Trạng thái giỏ trống', false]],
    prerequisites: [3],
  },
  {
    title: 'Trang thanh toán',
    description: 'Nhập địa chỉ, chọn cách thanh toán, xem lại đơn và chuyển sang VNPay.',
    status: 'IN_PROGRESS', priority: 'HIGH', creator: 'anh', assignee: 'anh', start: -1, due: 1, estimate: [360, 540],
    completionCriteria: 'Đặt hàng thử từ đầu đến cuối thành công trên sandbox.',
    priorityReason: 'Bước tạo ra doanh thu.',
    prerequisites: [4],
  },
  {
    title: 'Sửa lỗi vỡ bố cục trên màn hình dưới 375px',
    description: 'Thanh điều hướng tràn ngang và nút mua bị che trên điện thoại màn hình nhỏ.',
    status: 'IN_PROGRESS', priority: 'MEDIUM', creator: 'anh', assignee: 'anh', start: 0, due: 0, estimate: [60, 120],
    completionCriteria: 'Không còn thanh cuộn ngang ở chiều rộng 320px trên mọi trang.',
    priorityReason: 'Hơn nửa số khách dùng điện thoại; hạn hôm nay.',
  },
  {
    title: 'Trang lịch sử đơn hàng',
    description: 'Danh sách đơn đã đặt, lọc theo trạng thái và xem chi tiết từng đơn.',
    status: 'TODO', priority: 'MEDIUM', creator: 'anh', assignee: 'anh', start: 2, due: 4, estimate: [180, 300],
    completionCriteria: 'Khách xem được trạng thái mới nhất của từng đơn.',
    priorityReason: 'Giảm số câu hỏi gửi đến bộ phận hỗ trợ.',
    prerequisites: [5],
  },
  {
    title: 'Chế độ tối',
    description: 'Thêm bảng màu tối và nút chuyển, nhớ lựa chọn của người dùng.',
    status: 'TODO', priority: 'LOW', creator: 'anh', assignee: null, start: null, due: null, estimate: [120, 240],
    completionCriteria: 'Mọi trang đọc được ở chế độ tối, độ tương phản đạt chuẩn AA.',
    priorityReason: 'Có thì tốt, chưa ai yêu cầu gấp.',
  },
  {
    title: 'Thông báo trạng thái đơn theo thời gian thực',
    description: 'Khi đơn đổi trạng thái, trang đang mở tự cập nhật mà không cần tải lại.',
    status: 'TODO', priority: 'MEDIUM', creator: 'anh', assignee: null, start: 3, due: 6, estimate: [240, 420],
    completionCriteria: 'Mở hai trình duyệt: đổi trạng thái ở một bên, bên kia cập nhật trong vài giây.',
    priorityReason: 'Tạo cảm giác tin cậy sau khi khách trả tiền.',
    prerequisites: [7],
  },
  {
    title: 'Kiểm tra thao tác bằng bàn phím',
    description: 'Đi hết luồng mua hàng chỉ bằng bàn phím, sửa thứ tự focus và nhãn cho trình đọc màn hình.',
    status: 'TODO', priority: 'MEDIUM', creator: 'anh', assignee: 'anh', start: 4, due: 7, estimate: [180, 300],
    completionCriteria: 'Mua được hàng mà không dùng chuột; focus luôn nhìn thấy được.',
    priorityReason: 'Yêu cầu bắt buộc trước khi phát hành.',
  },
  {
    title: 'Tối ưu ảnh sản phẩm và điểm Lighthouse',
    description: 'Dùng ảnh đúng kích thước, tải chậm ảnh ngoài màn hình và giảm dung lượng JavaScript.',
    status: 'TODO', priority: 'LOW', creator: 'anh', assignee: null, start: 5, due: 7, estimate: [120, 240],
    completionCriteria: 'Điểm hiệu năng Lighthouse trên điện thoại đạt từ 90.',
    priorityReason: 'Cải thiện dần, không chặn phát hành.',
  },
  {
    title: 'Form địa chỉ giao hàng theo tỉnh, quận, phường',
    description: 'Ba ô chọn phụ thuộc nhau, có tìm kiếm và nhớ địa chỉ dùng gần nhất.',
    status: 'TODO', priority: 'HIGH', creator: 'anh', assignee: null, start: 1, due: 2, estimate: [180, 300],
    completionCriteria: 'Chọn tỉnh thì danh sách quận đổi theo; không gửi được form thiếu phường.',
    priorityReason: 'Trang thanh toán không hoàn thành được nếu thiếu form này.',
  },
  {
    title: 'Viết test cho giỏ hàng',
    description: 'Test thêm, đổi số lượng, xoá và tính tổng tiền, gồm cả trường hợp hết hàng.',
    status: 'TODO', priority: 'LOW', creator: 'anh', assignee: 'anh', start: null, due: 3, estimate: [90, 180],
    completionCriteria: 'Test chạy trong CI và bắt được lỗi tính sai tổng tiền.',
    priorityReason: 'Giỏ hàng hay bị sửa nên cần lưới an toàn.',
    prerequisites: [4],
  },
];

const operationsTasks: SeedTask[] = [
  {
    title: 'Thanh toán tiền điện nước tháng này',
    description: 'Hoá đơn điện và nước của quán, chuyển khoản rồi lưu lại biên lai.',
    status: 'TODO', priority: 'HIGH', creator: 'khanh', assignee: 'khanh', start: null, due: -1, estimate: [15, 30],
    completionCriteria: 'Có biên lai chuyển khoản trong thư mục chứng từ.',
    priorityReason: 'Đã quá hạn một ngày.',
  },
  {
    title: 'Kiểm kê nguyên liệu cuối tuần',
    description: 'Đếm cà phê hạt, sữa, siro và ly giấy; ghi số lượng vào sổ kho.',
    status: 'TODO', priority: 'MEDIUM', creator: 'khanh', assignee: 'khanh', start: 0, due: 0, estimate: [60, 90],
    completionCriteria: 'Sổ kho khớp với số đếm thực tế.',
    priorityReason: 'Cần số liệu để đặt hàng cho tuần sau.',
    checklist: [['Cà phê hạt', false], ['Sữa và siro', false], ['Ly và ống hút', false]],
  },
  {
    title: 'Đặt cà phê hạt cho tháng tới',
    description: 'Liên hệ nhà rang ở Đà Lạt, chốt số lượng Arabica và Robusta.',
    status: 'IN_PROGRESS', priority: 'HIGH', creator: 'khanh', assignee: 'khanh', start: -1, due: 1, estimate: [30, 60],
    completionCriteria: 'Nhà rang xác nhận đơn và ngày giao.',
    priorityReason: 'Hàng trong kho chỉ còn đủ dùng khoảng mười ngày.',
    prerequisites: [1],
  },
  {
    title: 'Xếp lịch ca làm tuần sau',
    description: 'Xếp ca sáng và ca chiều cho năm nhân viên, tránh trùng lịch học của các bạn sinh viên.',
    status: 'TODO', priority: 'MEDIUM', creator: 'khanh', assignee: null, start: 1, due: 2, estimate: [30, 60],
    completionCriteria: 'Lịch được gửi vào nhóm chat và mọi người xác nhận.',
    priorityReason: 'Nhân viên cần biết lịch trước cuối tuần.',
  },
  {
    title: 'Bảo trì máy pha cà phê',
    description: 'Vệ sinh họng pha, thay gioăng và kiểm tra áp suất.',
    status: 'TODO', priority: 'LOW', creator: 'khanh', assignee: null, start: null, due: 6, estimate: [60, 120],
    completionCriteria: 'Máy chạy đúng áp suất 9 bar sau khi bảo trì.',
    priorityReason: 'Bảo trì định kỳ, máy vẫn đang chạy tốt.',
  },
  {
    title: 'Cập nhật thực đơn mùa thu',
    description: 'Thêm ba món mới, in lại thực đơn và cập nhật giá trên máy tính tiền.',
    status: 'DONE', priority: 'MEDIUM', creator: 'khanh', assignee: 'khanh', start: -5, due: -2, estimate: [120, 180],
    completionCriteria: 'Thực đơn mới có ở quầy và giá trên máy tính tiền khớp với bản in.',
    priorityReason: 'Kịp cho đợt khách đầu mùa.',
  },
];

export const teams: Record<TeamKey, SeedTeam> = {
  backend: {
    id: '30000000-0000-4000-8000-000000000001', workspace: 'studio', name: 'Backend', taskIdPrefix: '40000000',
    members: ['anh'], tasks: backendTasks,
  },
  frontend: {
    id: '30000000-0000-4000-8000-000000000003', workspace: 'studio', name: 'Frontend', taskIdPrefix: '41000000',
    members: ['anh'], tasks: frontendTasks,
  },
  operations: {
    id: '30000000-0000-4000-8000-000000000002', workspace: 'cafe', name: 'Vận hành', taskIdPrefix: '50000000',
    members: ['khanh'], tasks: operationsTasks,
  },
};
