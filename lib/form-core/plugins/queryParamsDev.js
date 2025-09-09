
export const queryparams = (options = {}) => {
  const state = {};
  return {
    init(ctx) {
      
    },
    onValidationFail(errors, ctx) {
      // react to validation issues
    },
    async onSuccess(res, ctx) {
      // react to server success
    },
    onError(err, ctx) {
      // react to server error
    },
  };
};
