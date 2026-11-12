// 可直接顯示給客人看的錯誤（其餘錯誤一律只寫 log，回傳通用訊息）
class UserError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.name = "UserError";
    this.status = status;
  }
}

module.exports = { UserError };
