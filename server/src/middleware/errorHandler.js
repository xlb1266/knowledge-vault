const errorHandler = (err, req, res, next) => {
  console.error(`[Error] ${err.message}`);
  if (err.stack) {
    console.error(err.stack);
  }

  res.status(err.status || 500).json({
    success: false,
    error: err.message || '服务器内部错误',
  });
};

module.exports = { errorHandler };
