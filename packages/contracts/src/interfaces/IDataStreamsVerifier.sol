// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Interface for Chainlink Data Streams verifier contracts
interface IDataStreamsVerifier {
    /// @notice Verifies a Data Streams report cryptographically
    /// @param payload Cryptographically signed report blob
    /// @param parameterPayload Verification parameter blob
    /// @return verifierResponse Decoded and validated report response bytes
    function verify(bytes calldata payload, bytes calldata parameterPayload) external payable returns (bytes memory verifierResponse);
}
