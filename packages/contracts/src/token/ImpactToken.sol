// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

contract ImpactToken {
    string public name;
    string public symbol;
    uint8 public constant decimals = 18;
    uint256 public totalSupply;
    address public immutable minter;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    error Unauthorized();
    error ZeroAddress();
    error InsufficientBalance();
    error InsufficientAllowance();
    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);

    constructor(string memory name_, string memory symbol_, address minter_) {
        if (minter_ == address(0)) revert ZeroAddress();
        name = name_; symbol = symbol_; minter = minter_;
    }

    function approve(address spender, uint256 value) external returns (bool) {
        allowance[msg.sender][spender] = value;
        emit Approval(msg.sender, spender, value);
        return true;
    }

    function transfer(address to, uint256 value) external returns (bool) {
        _transfer(msg.sender, to, value); return true;
    }

    function transferFrom(address from, address to, uint256 value) external returns (bool) {
        uint256 allowed = allowance[from][msg.sender];
        if (allowed != type(uint256).max) {
            if (allowed < value) revert InsufficientAllowance();
            allowance[from][msg.sender] = allowed - value;
        }
        _transfer(from, to, value); return true;
    }

    function mint(address to, uint256 value) external {
        if (msg.sender != minter) revert Unauthorized();
        if (to == address(0)) revert ZeroAddress();
        totalSupply += value; balanceOf[to] += value;
        emit Transfer(address(0), to, value);
    }

    function burn(address from, uint256 value) external {
        if (msg.sender != minter) revert Unauthorized();
        uint256 bal = balanceOf[from];
        if (bal < value) revert InsufficientBalance();
        unchecked { balanceOf[from] = bal - value; totalSupply -= value; }
        emit Transfer(from, address(0), value);
    }

    function _transfer(address from, address to, uint256 value) internal {
        if (to == address(0)) revert ZeroAddress();
        uint256 bal = balanceOf[from];
        if (bal < value) revert InsufficientBalance();
        unchecked { balanceOf[from] = bal - value; balanceOf[to] += value; }
        emit Transfer(from, to, value);
    }
}
