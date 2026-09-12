// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

contract MockUSDC {
    string public constant name="Mock USDC"; string public constant symbol="USDC"; uint8 public constant decimals=6;
    uint256 public totalSupply; mapping(address=>uint256) public balanceOf; mapping(address=>mapping(address=>uint256)) public allowance;
    event Transfer(address indexed from,address indexed to,uint256 value); event Approval(address indexed owner,address indexed spender,uint256 value);
    function mint(address to,uint256 value) external {totalSupply+=value;balanceOf[to]+=value;emit Transfer(address(0),to,value);}
    function approve(address s,uint256 v) external returns(bool){allowance[msg.sender][s]=v;emit Approval(msg.sender,s,v);return true;}
    function transfer(address to,uint256 v) external returns(bool){_move(msg.sender,to,v);return true;}
    function transferFrom(address f,address t,uint256 v) external returns(bool){uint256 a=allowance[f][msg.sender];require(a>=v,"allowance");if(a!=type(uint256).max)allowance[f][msg.sender]=a-v;_move(f,t,v);return true;}
    function _move(address f,address t,uint256 v) internal {require(balanceOf[f]>=v&&t!=address(0),"transfer");balanceOf[f]-=v;balanceOf[t]+=v;emit Transfer(f,t,v);}
}
