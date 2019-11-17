// Global key for canMakepayment cache.
const canMakePaymentCache = 'canMakePaymentCache';
const allowedCardNetworks = ["MASTERCARD", "VISA"];
const allowedCardAuthMethods = ["PAN_ONLY", "CRYPTOGRAM_3DS"];

/**
 * Read data for supported instruments from input from.
 */
function readSupportedInstruments() {
  let formValue = {};
  formValue['pa'] = document.getElementById('pa').value;
  formValue['pn'] = document.getElementById('pn').value;
  formValue['tn'] = document.getElementById('tn').value;
  formValue['mc'] = document.getElementById('mc').value;
  formValue['tr'] = document.getElementById('tr').value;
  formValue['tid'] = document.getElementById('tid').value;
  formValue['url'] = document.getElementById('url').value;
  return formValue;
}

/**
 * Read the amount from input form.
 */
function readAmount() {
  return document.getElementById('amount').value;
}

/**
 * Define your unique Google Pay API configuration
 *
 * @returns {object} data attribute suitable for PaymentMethodData
 */
function getGooglePaymentsConfiguration() {
  return {
    environment: 'TEST',
    apiVersion: 2,
    apiVersionMinor: 0,
    merchantInfo: {
      // A merchant ID is available after approval by Google.
      // 'merchantId':'01234567890123456789',
      merchantName: 'Example Merchant'
    },
    allowedPaymentMethods: [{
      type: 'CARD',
      parameters: {
        allowedAuthMethods: allowedCardAuthMethods,
        allowedCardNetworks: allowedCardNetworks
      },
      tokenizationSpecification: {
        type: 'PAYMENT_GATEWAY',
        // Check with your payment gateway on the parameters to pass.
        // @see {@link https://developers.google.com/pay/api/web/reference/object#Gateway}
        parameters: {
          'gateway': 'example',
          'gatewayMerchantId': 'exampleGatewayMerchantId'
        }
      }
    }]
  };
}

/**
 * Launches payment request.
 */
function onBuyClicked() {
  if (!window.PaymentRequest) {
    alert('Web payments are not supported in this browser. UA: ' + window.navigator.userAgent);
    return;
  }

  let formValue = readSupportedInstruments();

  const supportedInstruments = [
    {
      supportedMethods: ['https://pwp-server.appspot.com/pay-dev'],
      data: formValue,
    },
    {
      supportedMethods: ['https://google.com/pay'],
      // data: formValue,
      data: getGooglePaymentsConfiguration()
    },
    {
      supportedMethods: ['basic-card'],
      data: {
        supportedNetworks: allowedCardNetworks.map(network => network.toLowerCase())
      }
    }
  ];

  const details = {
    total: {
      label: 'Total',
      amount: {
        currency: 'INR',
        value: readAmount(),
      },
    },
    displayItems: [
      {
        label: 'Original amount',
        amount: {
          currency: 'INR',
          value: readAmount(),
        },
      },
    ],
  };

  const options = {
    requestShipping: true,
    requestPayerName: true,
    requestPayerPhone: true,
    requestPayerEmail: true,
    shippingType: 'shipping',
  };

  let request = null;
  try {
    request = new PaymentRequest(supportedInstruments, details, options);
  } catch (e) {
    alert('Payment Request Error: ' + e.message);
    return;
  }
  if (!request) {
    alert('Web payments are not supported in this browser.');
    return;
  }

  request.addEventListener('shippingaddresschange', function(evt) {
    evt.updateWith(new Promise(function(resolve) {
      fetch('/ship', {
        method: 'POST',
        headers: new Headers({'Content-Type': 'application/json'}),
        body: addressToJsonString(request.shippingAddress),
        credentials: 'include',
      })
          .then(function(options) {
            if (options.ok) {
              return options.json();
            }
            alert('Unable to calculate shipping options.');
          })
          .then(function(optionsJson) {
            if (optionsJson.status === 'success') {
              updateShipping(details, optionsJson.shippingOptions, resolve);
            } else {
              alert('Unable to calculate shipping options.');
            }
          })
          .catch(function(err) {
            alert('Unable to calculate shipping options. ' + err);
          });
    }));
  });

  request.addEventListener('shippingoptionchange', function(evt) {
    evt.updateWith(new Promise(function(resolve) {
      for (let i in details.shippingOptions) {
        if ({}.hasOwnProperty.call(details.shippingOptions, i)) {
          details.shippingOptions[i].selected =
              (details.shippingOptions[i].id === request.shippingOption);
        }
      }

      updateShipping(details, details.shippingOptions, resolve);
    }));
  });

  var canMakePaymentPromise = checkCanMakePayment(request);
  canMakePaymentPromise
      .then((result) => {
        showPaymentUI(request, result);
      })
      .catch((err) => {
        alert('Error calling checkCanMakePayment: ' + err);
      });
}

/**
 * Checks whether can make a payment with Tez on this device. It checks the
 * session storage cache first and uses the cached information if it exists.
 * Otherwise, it calls canMakePayment method from the Payment Request object and
 * returns the result. The result is also stored in the session storage cache
 * for future use.
 *
 * @private
 * @param {PaymentRequest} request The payment request object.
 * @return {Promise} a promise containing the result of whether can make payment.
 */
function checkCanMakePayment(request) {
  // Checks canMakePayment cache, and use the cache result if it exists.
  if (sessionStorage.hasOwnProperty(canMakePaymentCache)) {
    return Promise.resolve(JSON.parse(sessionStorage[canMakePaymentCache]));
  }

  // If canMakePayment() isn't available, default to assuming that the method is
  // supported.
  var canMakePaymentPromise = Promise.resolve(true);

  // Feature detect canMakePayment().
  if (request.canMakePayment) {
    canMakePaymentPromise = request.canMakePayment();
  }

  return canMakePaymentPromise
      .then((result) => {
        // Store the result in cache for future usage.
        sessionStorage[canMakePaymentCache] = result;
        return result;
      })
      .catch((err) => {
        alert('Error calling canMakePayment: ' + (err.stack || err));
      });
}

/**
 * Show the payment request UI.
 *
 * @private
 * @param {PaymentRequest} request The payment request object.
 * @param {Promise} canMakePayment The promise for whether can make payment.
 */
function showPaymentUI(request, canMakePayment) {
  // Redirect to play store if can't make payment.
  if (!canMakePayment) {
    redirectToPlayStore();
    return;
  }

  // Set payment timeout.
  let paymentTimeout = window.setTimeout(function() {
    window.clearTimeout(paymentTimeout);
    request.abort()
        .then(function() {
          alert('Payment timed out after 20 minutes.');
        })
        .catch(function() {
          alert('Unable to abort, user is in the process of paying.');
        });
  }, 20 * 60 * 1000); /* 20 minutes */

  request.show()
      .then(function(instrument) {
        window.clearTimeout(paymentTimeout);
        processResponse(instrument);  // Handle response from browser.
      })
      .catch(function(err) {
        alert(err);
      });
}

/**
 * Process the response from browser.
 *
 * @private
 * @param {PaymentResponse} instrument The payment instrument that was authed.
 */
function processResponse(instrument) {
  var instrumentString = instrumentToJsonString(instrument);
  alert(instrumentString);

  fetch('/buy', {
    method: 'POST',
    headers: new Headers({'Content-Type': 'application/json'}),
    body: instrumentString,
    credentials: 'include',
  })
      .then(function(buyResult) {
        if (buyResult.ok) {
          return buyResult.json();
        }
        alert('Error sending instrument to server.');
      })
      .then(function(buyResultJson) {
        completePayment(
            instrument, buyResultJson.status, buyResultJson.message);
      })
      .catch(function(err) {
        alert('Unable to process payment. ' + err);
      });
}

/**
 * Notify browser that the instrument authorization has completed.
 *
 * @private
 * @param {PaymentResponse} instrument The payment instrument that was authed.
 * @param {string} result Whether the auth was successful. Should be either
 * 'success' or 'fail'.
 * @param {string} msg The message to log in console.
 */
function completePayment(instrument, result, msg) {
  instrument.complete(result)
      .then(function() {
        alert('Payment completes.');
        alert(msg);
        document.getElementById('inputSection').style.display = 'none'
        document.getElementById('outputSection').style.display = 'block'
        document.getElementById('response').innerHTML =
            JSON.stringify(instrument, undefined, 2);
      })
      .catch(function(err) {
        alert(err);
      });
}

/** Redirect to PlayStore. */
function redirectToPlayStore() {
  if (confirm('Tez not installed, go to play store and install?')) {
    window.location.href =
        'https://play.google.com/store/apps/details?id=com.google.android.apps.nbu.paisa.user'
  };
}

/**
 * Converts the shipping address into a JSON string.
 *
 * @private
 * @param {PaymentAddress} address The address to convert.
 * @return {string} The string representation of the address.
 */
function addressToJsonString(address) {
  var addressDictionary = address.toJSON ? address.toJSON() : {
    recipient: address.recipient,
    organization: address.organization,
    addressLine: address.addressLine,
    dependentLocality: address.dependentLocality,
    city: address.city,
    region: address.region,
    postalCode: address.postalCode,
    sortingCode: address.sortingCode,
    country: address.country,
    phone: address.phone,
  };
  return JSON.stringify(addressDictionary, undefined, 2);
}

/**
 * Converts the payment instrument into a JSON string.
 *
 * @private
 * @param {PaymentResponse} instrument The instrument to convert.
 * @return {string} The string representation of the instrument.
 */
function instrumentToJsonString(instrument) {
  // PaymentResponse is an interface, JSON.stringify works only on dictionaries.
  var instrumentDictionary = {
    methodName: instrument.methodName,
    details: instrument.details,
    shippingAddress: addressToJsonString(instrument.shippingAddress),
    shippingOption: instrument.shippingOption,
    payerName: instrument.payerName,
    payerPhone: instrument.payerPhone,
    payerEmail: instrument.payerEmail,
  };
  return JSON.stringify(instrumentDictionary, undefined, 2);
}

/**
 * Update order details with shipping information.
 *
 * @private
 * @param {PaymentDetails} details The details for payment.
 * @param {Array} shippingOptions The shipping options.
 * @param {function} callback The callback to invoke.
 */
function updateShipping(details, shippingOptions, callback) {
  let selectedShippingOption;
  for (let i in shippingOptions) {
    if (shippingOptions[i].selected) {
      selectedShippingOption = shippingOptions[i];
    }
  }

  var total = parseFloat(readAmount());
  if (selectedShippingOption) {
    let shippingPrice = Number(selectedShippingOption.amount.value);
    total = total + shippingPrice;
  }

  details.shippingOptions = shippingOptions;
  details.total.amount.value = total.toFixed(2);
  if (selectedShippingOption) {
    details.displayItems.splice(
        1, details.displayItems.length == 1 ? 0 : 1, selectedShippingOption);
  }

  callback(details);
}
