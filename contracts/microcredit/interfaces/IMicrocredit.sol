//SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.4;

import {IERC20Upgradeable as IERC20} from "@openzeppelin/contracts-upgradeable/token/ERC20/IERC20Upgradeable.sol";
import "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";
import "../../donationMiner/interfaces/IDonationMiner.sol";
import "../../microcreditManager/interfaces/IMicrocreditManager.sol";
import "../../externalInterfaces/uniswapV3/IUniswapRouter02.sol";
import "../../externalInterfaces/uniswapV3/IQuoter.sol";

interface IMicrocredit {
    struct UserOld {
        LoanOld[] loans;
    }

    struct LoanOld {
        uint256 amountBorrowed;
        uint256 period;                   // the number of seconds after a loan should be fully repaid
        uint256 dailyInterest;
        uint256 claimDeadline;
        uint256 startDate;                // the timestamp the user claimed the amountBorrowed
        uint256 lastComputedDebt;
        uint256 amountRepayed;
        Repayment[] repayments;
        uint256 lastComputedDate;
//        address managerAddress;
    }

    struct WalletMetadata {
        uint256 userId;
        address movedTo;
    }

    struct User {
        uint256 loansLength;
        mapping(uint256 => Loan) loans;
    }

    struct Manager {
        uint256 lentAmountLimit;
        uint256 lentAmount;
    }

    struct Repayment {
        uint256 date;
        uint256 amount;
        uint256 tokenAmount;
    }

    struct Loan {
        uint256 amountBorrowed;           //this value is expressed in usd
        uint256 period;                   // the number of seconds after a loan should be fully repaid
        uint256 dailyInterest;
        uint256 claimDeadline;
        uint256 startDate;                // the timestamp the user claimed the amountBorrowed
        uint256 lastComputedDebt;
        uint256 amountRepayed;
        uint256 repaymentsLength;
        mapping(uint256 => Repayment) repayments;
        uint256 lastComputedDate;
        address managerAddress;
        address tokenAddress;
        uint256 tokenAmountBorrowed;
        uint256 tokenAmountRepayed;
//        address paymentTokenAddress;         //this will be used only if we allow payments with other tokens
    }

    struct Token {
        bool active;
        EnumerableSet.AddressSet exchangeTokens;
        mapping(address => uint24) exchangeTokensFees;
    }

    function getVersion() external pure returns(uint256);
    function cUSD() external view returns(IERC20);
    function revenueAddress() external view returns(address);
    function donationMiner() external view returns(IDonationMiner);
    function uniswapRouter() external view returns(IUniswapRouter02);
    function uniswapQuoter() external view returns(IQuoter);
    function microcreditManager() external view returns(IMicrocreditManager);
    function walletMetadata(address userAddress)
        external view returns(uint256 userId, address movedTo, uint256 loansLength);
    struct UserLoanResponse {
        uint256 amountBorrowed;
        uint256 period;
        uint256 dailyInterest;
        uint256 claimDeadline;
        uint256 startDate;
        uint256 currentDebt;
        uint256 lastComputedDebt;
        uint256 amountRepayed;
        uint256 repaymentsLength;
        uint256 lastComputedDate;
        address managerAddress;
        address tokenAddress;
        uint256 tokenAmountBorrowed;
        uint256 tokenAmountRepayed;
        uint256 tokenLastComputedDebt;
        uint256 tokenCurrentDebt;
//        address paymentTokenAddress;
    }
    function userLoans(address userAddress, uint256 loanId) external returns(
        UserLoanResponse memory userLoan);
    function userLoanRepayments(address userAddress, uint256 loanId, uint256 repaymentId)
        external view returns(Repayment memory repayment);
    function walletListAt(uint256 index) external view returns (address);
    function walletListLength() external view returns (uint256);
    function maintainerListAt(uint256 index) external view returns (address);
    function maintainerListLength() external view returns (uint256);
    function managerListAt(uint256 index) external view returns (address);
    function managerListLength() external view returns (uint256);
    function managers(address managerAddress) external view returns(Manager memory);
    function tokenListAt(uint256 index) external view returns (address);
    function tokenListLength() external view returns (uint256);
    function tokens(address tokenAddress) external view returns (bool active);
    function updateRevenueAddress(address newRevenueAddress) external;
    function updateDonationMiner(IDonationMiner newDonationMiner) external;
    function updateUniswapRouter(IUniswapRouter02 _uniswapRouter) external;
    function updateUniswapQuoter(IQuoter _uniswapQuoter) external;
    function updateMicrocreditManager(IMicrocreditManager _uniswapQuoter) external;
    function addMaintainers(address[] calldata _maintainerAddresses) external;
    function removeMaintainers(address[] calldata _maintainerAddresses) external;
    function addManagers(
        address[] calldata managerAddresses,
        uint256[] calldata lentAmountLimits
    ) external;
    function removeManagers(address[] calldata managerAddresses) external;
    function addLoan(
        address userAddress,
        address tokenAddress,
        uint256 amount,
        uint256 period,
        uint256 dailyInterest,
        uint256 claimDeadline
    ) external;
    function addLoans(
        address[] calldata userAddresses,
        address[] calldata tokenAddresses,
        uint256[] calldata amounts,
        uint256[] calldata periods,
        uint256[] calldata dailyInterests,
        uint256[] calldata claimDeadlines
    ) external;
    function editLoanClaimDeadlines(
        address[] calldata userAddresses,
        uint256[] calldata loanIds,
        uint256[] calldata newClaimDeadlines
    ) external;
    function cancelLoans(
        address[] calldata userAddresses,
        uint256[] calldata loansIds
    ) external;
    function changeUserAddress(address oldWalletAddress, address newWalletAddress) external;
    function claimLoan(uint256 loanId) external;
    function repayLoan(uint256 loanId, uint256 repaymentAmount) external;
    function changeBorrowerManager(address[] memory borrowerAddresses, address managerAddress) external;
    function addToken(
        address tokenAddress,
        address[] calldata exchangeTokens,
        uint24[] calldata exchangeTokensFees
    ) external;
    function inactivateToken(address tokenAddress) external;
    function transferERC20(IERC20 token, address to, uint256 amount) external;
}

