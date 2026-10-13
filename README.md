# Sleep Story

Web app nghe truyện tiếng Anh từ [The Fable Cottage](https://www.thefablecottage.com/) để ngủ.

- Mở trang là tự phát truyện đầu tiên; hết truyện tự phát truyện tiếp theo, hết danh sách thì quay lại từ đầu.
- Công tắc **Tự chuyển bài**: BẬT thì phát lần lượt cả danh sách; TẮT thì phát lại truyện đang nghe.
- **Hẹn giờ tắt**: 30 phút, 1 giờ, 2 giờ hoặc số phút tùy chỉnh. Âm lượng giảm dần trong 30 giây cuối rồi dừng. Bấm lại nút đang chọn để hủy.
- Có thể thêm truyện thủ công (tên + link audio), lưu trong trình duyệt.

## Lấy danh sách truyện

```bash
node scripts/scrape.mjs
# Nếu có tài khoản thành viên, truyền cookie đăng nhập để lấy cả truyện trả phí:
FABLE_COOKIE="..." node scripts/scrape.mjs
```

Script đọc trang `/languages/english` (kể cả các trang phân trang), mở từng trang truyện, lấy tên và link audio rồi ghi vào `stories.json`.
Audio vẫn được phát trực tiếp từ server của The Fable Cottage; script không tải file về.
Cần Node 18 trở lên.

## Chạy

```bash
python3 -m http.server 8000
# mở http://localhost:8000
```

Lưu ý: trình duyệt thường chặn tự phát âm thanh khi chưa có thao tác của người dùng.
Khi bị chặn, app hiện nút "Bấm để bắt đầu nghe"; sau đó phát và chuyển bài tự động như bình thường.
