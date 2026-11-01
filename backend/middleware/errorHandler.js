
const handleCastError = (err) => ({
  status: 400,
  message: `Invalid ID format: ${err.value}`,
});

const handleDuplicateKey = (err) => {
  const field = Object.keys(err.keyValue)[0];
  const value = err.keyValue[field];

  return {
    status: 409,
    message: `"${value}" already exists for field: ${field}`,
  };
};

const handleValidationError = (err) => {
  const messages = Object.values(err.errors).map((e) => e.message);

  return {
    status: 400,
    message: messages.join(", "),
  };
};

const errorHandler = (err, req, res, next) => {
  console.error(`[ERROR] ${req.method} ${req.originalUrl} →`, err.message);

  let status = err.statusCode || err.status || 500;
  let message = err.message || "Internal Server Error";

  // Mongoose errors
  if (err.name === "CastError") {
    ({ status, message } = handleCastError(err));
  } else if (err.code === 11000) {
    ({ status, message } = handleDuplicateKey(err));
  } else if (err.name === "ValidationError") {
    ({ status, message } = handleValidationError(err));
  }

  // Multer upload errors
  else if (err.name === "MulterError") {
    if (err.code === "LIMIT_FILE_SIZE") {
      status = 413;
      message = "File too large. Maximum allowed size is 5MB.";
    } else {
      status = 400;
      message = err.message || "Invalid file upload.";
    }
  }

  // Invalid image type
  else if (err.message === "Only image uploads are allowed.") {
    status = 400;
    message = "Only image uploads are allowed.";
  }

  res.status(status).json({
    success: false,
    message,
  });
};

module.exports = errorHandler;
