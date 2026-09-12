// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

abstract contract Ownable {
    address public owner;
    error Unauthorized();
    error ZeroAddress();
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);

    constructor(address initialOwner) {
        if (initialOwner == address(0)) revert ZeroAddress();
        owner = initialOwner;
        emit OwnershipTransferred(address(0), initialOwner);
    }

    modifier onlyOwner() { if (msg.sender != owner) revert Unauthorized(); _; }

    function transferOwnership(address newOwner) external onlyOwner {
        if (newOwner == address(0)) revert ZeroAddress();
        emit OwnershipTransferred(owner, newOwner);
        owner = newOwner;
    }
}
