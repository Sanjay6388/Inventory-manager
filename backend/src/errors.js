class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function asyncHandler(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

function handleError(error, req, res, next) {
  if (error.name === 'ZodError') {
    return res.status(422).json({ detail: error.errors.map((item) => item.message).join(', ') });
  }

  if (error.code === '23505') {
    const detail = error.constraint && error.constraint.includes('customers')
      ? 'Customer email must be unique'
      : 'Product SKU must be unique';
    return res.status(409).json({ detail });
  }

  if (error.code === '23503') {
    return res.status(409).json({ detail: 'Cannot delete a record that is attached to existing data' });
  }

  if (error.status) {
    return res.status(error.status).json({ detail: error.message });
  }

  console.error(error);
  return res.status(500).json({ detail: 'Internal server error' });
}

module.exports = { HttpError, asyncHandler, handleError };

