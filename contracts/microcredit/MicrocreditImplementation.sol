//SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.4;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/security/PausableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/security/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/utils/SafeERC20Upgradeable.sol";
import "./interfaces/MicrocreditStorageV1.sol";

import "hardhat/console.sol";

contract MicrocreditImplementation is
    Initializable,
    OwnableUpgradeable,
    PausableUpgradeable,
    ReentrancyGuardUpgradeable,
    MicrocreditStorageV1
{
    using SafeERC20Upgradeable for IERC20;
    using EnumerableSet for EnumerableSet.AddressSet;

    address public constant DEFAULT_LENDER_ADDRESS = 0xE6662E970CD54c154af8b9dEd54C95a69b133A5a;
    uint256 public constant REWARD_MULTIPLIER = 10;

    event MaintainerAdded(
        address indexed maintainerAddress
    );

    event MaintainerRemoved(address indexed maintainerRemovedAddress);

    event ManagerAdded(
        address indexed managerAddress,
        uint256 lentAmountLimit
    );

    event ManagerRemoved(address indexed managerAddress);

    event LoanAdded(
        address indexed userAddress,
        address indexed tokenAddress,
        uint256 loanId,
        uint256 amount,
        uint256 period,
        uint256 dailyInterest,
        uint256 claimDeadline
    );

    event LoanEdited(
        address indexed _userAddress,
        uint256 _loanId,
        uint256 _newPeriod,
        uint256 _newClaimDeadline,
        uint256 _newDailyInterest,
        uint256 _newLastComputedDebt,
        uint256 _newLastComputedDate
    );

    event LoanCanceled(address indexed userAddress, uint256 loanId);

    event UserAddressChanged(address indexed oldWalletAddress, address indexed newWalletAddress);

    event LoanClaimed(address indexed userAddress, uint256 loanId);

    event RepaymentAdded(
        address indexed userAddress,
        uint256 loanId,
        uint256 repaymentAmount,
        uint256 currentDebt
    );

    /**
     * @notice Triggered when a borrower's manager has been changed
     *
     * @param borrowerAddress   The address of the borrower
     * @param managerAddress    The address of the new manager
     */
    event ManagerChanged(address indexed borrowerAddress, address indexed managerAddress);

    event TokenAdded(address indexed tokenAddress);

    event TokenRemoved(address indexed tokenAddress);

    modifier onlyManagers() {
        require(_managerList.contains(msg.sender), "Microcredit: caller is not a manager");
        _;
    }

    modifier onlyMaintainers() {
        require(
            _maintainerList.contains(msg.sender) || msg.sender == owner(),
            "Microcredit: caller is not a maintainer");
        _;
    }

    /**
     * @notice Used to initialize the Microcredit contract
     *
     * @param _cUSDAddress      The address of the cUSD token
     * @param _revenueAddress   The address that collects all the interest
     */
    function initialize(address _cUSDAddress, address _revenueAddress) public initializer {
        __Ownable_init();
        __Pausable_init();
        __ReentrancyGuard_init();

        cUSD = IERC20(_cUSDAddress);
        revenueAddress = _revenueAddress == address(0) ? address(this) : _revenueAddress;
    }

    /**
     * @notice Returns the current implementation version
     */
    function getVersion() external pure override returns (uint256) {
        return 2;
    }

    /**
     * @notice Returns the information of a user
     *
     * @param _userAddress           address of the user
     * @return userId                the userId
     * @return movedTo               the number of the user's loans
     * @return loansLength           the number of the user's loans
     */
    function walletMetadata(address _userAddress)
        external
        view
        override
        returns (
            uint256 userId,
            address movedTo,
            uint256 loansLength
        )
    {
        WalletMetadata memory _metadata = _walletMetadata[_userAddress];

        userId = _metadata.userId;
        movedTo = _metadata.movedTo;
        loansLength = _users[_metadata.userId].loansLength;
    }

    /**
     * @notice Returns the length of the walletList
     */
    function walletListLength() external view override returns (uint256) {
        return _walletList.length();
    }

    /**
     * @notice Returns an address from the walletList
     *
     * @param _index index value
     * @return address of the user
     */
    function walletListAt(uint256 _index) external view override returns (address) {
        return _walletList.at(_index);
    }

    /**
     * @notice Returns an address from the maintainerList
     *
     * @param _index index value
     * @return address of the maintainer
     */
    function maintainerListAt(uint256 _index) external view override returns (address) {
        return _maintainerList.at(_index);
    }

    /**
     * @notice Returns the length of the maintainerList
     */
    function maintainerListLength() external view override returns (uint256) {
        return _maintainerList.length();
    }

    /**
     * @notice Returns an address from the managerList
     *
     * @param _index index value
     * @return address of the manager
     */
    function managerListAt(uint256 _index) external view override returns (address) {
        return _managerList.at(_index);
    }

    /**
     * @notice Returns the length of the managerList
     */
    function managerListLength() external view override returns (uint256) {
        return _managerList.length();
    }

    function managers(address _managerAddress)
        external
        view
        override
        returns (Manager memory)
    {
        return _managers[_managerAddress];
    }

    /**
     * @notice Returns the length of the tokenList
     */
    function tokenListLength() external view override returns (uint256) {
        return _tokenList.length();
    }

    /**
     * @notice Returns an address from the tokenList
     *
     * @param _index index value
     * @return address of the token
     */
    function tokenListAt(uint256 _index) external view override returns (address) {
        return _tokenList.at(_index);
    }

    function tokens(address _tokenAddress) external view override returns (bool active) {
        active = _tokens[_tokenAddress].active;
    }

    function userLoans(address _userAddress, uint256 _loanId)
        external
        override
        returns (UserLoanResponse memory userLoan)
    {
        _checkUserLoan(_userAddress, _loanId);

        WalletMetadata memory _metadata = _walletMetadata[_userAddress];
        Loan storage _loan = _users[_metadata.userId].loans[_loanId];

        userLoan.amountBorrowed = _loan.amountBorrowed;
        userLoan.period = _loan.period;
        userLoan.dailyInterest = _loan.dailyInterest;
        userLoan.claimDeadline = _loan.claimDeadline;
        userLoan.startDate = _loan.startDate;
        userLoan.lastComputedDebt = _loan.lastComputedDebt;
        userLoan.currentDebt = _calculateCurrentDebt(_loan);
        userLoan.amountRepayed = _loan.amountRepayed;
        userLoan.repaymentsLength = _loan.repaymentsLength;
        userLoan.lastComputedDate = _loan.lastComputedDate;
        userLoan.managerAddress = _loan.managerAddress;
        userLoan.tokenAddress = _loan.tokenAddress;
        //if the loan hasn't been claimed, the userLoan.tokenAmountBorrowed is 0
        //so we need to compute it based on the current price
        userLoan.tokenAmountBorrowed = _loan.tokenAmountBorrowed > 0 ? _loan.tokenAmountBorrowed :
            _getTokenAmountFromExactCUSDOutput(
                _loan.tokenAddress,
                _loan.amountBorrowed
            );
        userLoan.tokenAmountRepayed = _loan.tokenAmountRepayed;
        userLoan.tokenLastComputedDebt = _getTokenAmountFromExactCUSDOutput(_loan.tokenAddress, userLoan.lastComputedDebt);
        userLoan.tokenCurrentDebt = _getTokenAmountFromExactCUSDOutput(_loan.tokenAddress, userLoan.currentDebt);
    }

    function userLoanRepayments(
        address _userAddress,
        uint256 _loanId,
        uint256 _repaymentId
    ) external view override returns (Repayment memory repayment) {
        _checkUserLoan(_userAddress, _loanId);

        WalletMetadata memory _metadata = _walletMetadata[_userAddress];
        User storage _user = _users[_metadata.userId];
        Loan storage _loan = _user.loans[_loanId];

        require(_loan.repaymentsLength > _repaymentId, "Microcredit: Repayment doesn't exist");

        return _loan.repayments[_repaymentId];
    }

    /**
     * @dev Pauses the contract
     */
    function pause() public onlyOwner {
        _pause();
    }

    /**
     * @dev Unpauses the contract
     */
    function unpause() public onlyOwner {
        _unpause();
    }

    function updateRevenueAddress(address _newRevenueAddress) external override onlyOwner {
        require(_newRevenueAddress != address(0), "Microcredit: revenueAddress must be set");

        revenueAddress = _newRevenueAddress;
    }

    function updateDonationMiner(IDonationMiner _newDonationMiner) external override onlyOwner {
        donationMiner = _newDonationMiner;
    }

    function updateUniswapQuoter(IQuoter _newUniswapQuoter) external override onlyOwner {
        uniswapQuoter = _newUniswapQuoter;
    }

    function updateUniswapRouter(IUniswapRouter02 _newUniswapRouter) external override onlyOwner {
        uniswapRouter = _newUniswapRouter;
    }

    function updateMicrocreditManager(IMicrocreditManager _newMicrocreditManager) external override onlyOwner {
        microcreditManager = _newMicrocreditManager;
    }

    /**
     * @notice Adds maintainers
     *
     * @param _maintainerAddresses      addresses of the maintainers
     */
    function addMaintainers(address[] calldata _maintainerAddresses) external override onlyOwner {
        uint256 _length = _maintainerAddresses.length;
        uint256 _index;

        for (_index = 0; _index < _length; _index++) {
            _maintainerList.add(_maintainerAddresses[_index]);

            emit MaintainerAdded(
                _maintainerAddresses[_index]
            );
        }
    }

    /**
     * @notice Removes maintainers
     *
     * @param _maintainerAddresses     addresses of the maintainers
     */
    function removeMaintainers(address[] calldata _maintainerAddresses) external override onlyOwner {
        uint256 _length = _maintainerAddresses.length;
        uint256 _maintainerId;

        for (_maintainerId = 0; _maintainerId < _length; _maintainerId++) {
            _maintainerList.remove(_maintainerAddresses[_maintainerId]);

            emit MaintainerRemoved(_maintainerAddresses[_maintainerId]);
        }
    }

    /**
     * @notice Adds managers
     *
     * @param _managerAddresses      addresses of the managers
     */
    function addManagers(
        address[] calldata _managerAddresses,
        uint256[] calldata _lentAmountLimits
    ) external override onlyMaintainers {
        uint256 _length = _managerAddresses.length;
        uint256 _index;

        for (_index = 0; _index < _length; _index++) {
            _managerList.add(_managerAddresses[_index]);

            _managers[_managerAddresses[_index]].lentAmountLimit = _lentAmountLimits[_index];

            emit ManagerAdded(
                _managerAddresses[_index],
                _lentAmountLimits[_index]
            );
        }
    }

    /**
     * @notice Removes managers
     *
     * @param _managerAddresses     addresses of the managers
     */
    function removeManagers(address[] calldata _managerAddresses) external override onlyMaintainers {
        uint256 _length = _managerAddresses.length;
        uint256 _managerId;

        for (_managerId = 0; _managerId < _length; _managerId++) {
            require(_managers[_managerAddresses[_managerId]].lentAmount == 0, 'Microcredit: manager has ongoing loans');
            _managerList.remove(_managerAddresses[_managerId]);

            _managers[_managerAddresses[_managerId]].lentAmountLimit = 0;

            emit ManagerRemoved(_managerAddresses[_managerId]);
        }
    }

    /**
     * @notice Adds a loan
     *
     * @param _userAddress           address of the user
     * @param _tokenAddress          address of the token
     * @param _amount                amount of the loan
     * @param _period                period of the loan
     * @param _dailyInterest         daily interest of the loan
     * @param _claimDeadline         claim deadline of the loan
     */
    function addLoan(
        address _userAddress,
        address _tokenAddress,
        uint256 _amount,
        uint256 _period,
        uint256 _dailyInterest,
        uint256 _claimDeadline
    ) external override onlyManagers {
        _addLoan(_userAddress, _tokenAddress, _amount, _period, _dailyInterest, _claimDeadline);
    }

    /**
     * @notice Adds multiples loans
     *
     * @param _userAddresses          addresses of the user
     * @param _tokenAddresses         addresses of the tokens
     * @param _amounts                amounts of the loan
     * @param _periods                periods of the loan
     * @param _dailyInterests         daily interests of the loan
     * @param _claimDeadlines         claim deadlines of the loan
     */
    function addLoans(
        address[] calldata _userAddresses,
        address[] calldata _tokenAddresses,
        uint256[] calldata _amounts,
        uint256[] calldata _periods,
        uint256[] calldata _dailyInterests,
        uint256[] calldata _claimDeadlines
    ) external override onlyManagers {
        uint256 _loansNumber = _userAddresses.length;

        require(
            _loansNumber == _tokenAddresses.length,
            "Microcredit: calldata information arity mismatch"
        );
        require(
            _loansNumber == _amounts.length,
            "Microcredit: calldata information arity mismatch"
        );
        require(
            _loansNumber == _periods.length,
            "Microcredit: calldata information arity mismatch"
        );
        require(
            _loansNumber == _dailyInterests.length,
            "Microcredit: calldata information arity mismatch"
        );
        require(
            _loansNumber == _claimDeadlines.length,
            "Microcredit: calldata information arity mismatch"
        );

        uint256 _index;

        for (_index = 0; _index < _loansNumber; _index++) {
            _addLoan(
                _userAddresses[_index],
                _tokenAddresses[_index],
                _amounts[_index],
                _periods[_index],
                _dailyInterests[_index],
                _claimDeadlines[_index]
            );
        }
    }

    /**
     * @notice Edits multiples loans claim deadline
     *
     * @param _userAddresses             addresses of the user
     * @param _loanIds                   id of the loans
     * @param _newClaimDeadlines         new claim deadlines of the loan
     */
    function editLoanClaimDeadlines(
        address[] calldata _userAddresses,
        uint256[] calldata _loanIds,
        uint256[] calldata _newClaimDeadlines
    ) external override onlyManagers {
        uint256 _loansNumber = _userAddresses.length;

        require(
            _loansNumber == _loanIds.length,
            "Microcredit: calldata information arity mismatch"
        );
        require(
            _loansNumber == _newClaimDeadlines.length,
            "Microcredit: calldata information arity mismatch"
        );

        uint256 _index;
        for (_index = 0; _index < _loansNumber; _index++) {
            _checkUserLoan(_userAddresses[_index], _loanIds[_index]);

            WalletMetadata memory _metadata = _walletMetadata[_userAddresses[_index]];
            User storage _user = _users[_metadata.userId];
            Loan storage _loan = _user.loans[_loanIds[_index]];

            require(_loan.startDate == 0, 'Microcredit: Loan already claimed');
            require(_newClaimDeadlines[_index] > block.timestamp, 'Microcredit: invalid claimDeadline');
            _loan.claimDeadline = _newClaimDeadlines[_index];

            emit LoanEdited(
                _userAddresses[_index],
                _loanIds[_index],
                _loan.period,
                _newClaimDeadlines[_index],
                _loan.dailyInterest,
                _loan.lastComputedDebt,
                _loan.lastComputedDate
            );
        }
    }

    /**
     * @notice Cancel a loan
     *
     * @param _userAddresses    User addresses
     * @param _loansIds Loan ids
     */
    function cancelLoans(address[] calldata _userAddresses, uint256[] calldata _loansIds)
        external
        override
        onlyManagers
    {
        require(
            _userAddresses.length == _loansIds.length,
            "Microcredit: calldata information arity mismatch"
        );

        uint256 _index;

        for (_index = 0; _index < _userAddresses.length; _index++) {
            _cancelLoan(_userAddresses[_index], _loansIds[_index]);
        }
    }

    /**
     * @notice Change user address
     *
     * @param _oldWalletAddress Old wallet address
     * @param _newWalletAddress New wallet address
     */
    function changeUserAddress(address _oldWalletAddress, address _newWalletAddress)
        external
        override
        onlyMaintainers
    {
        WalletMetadata storage _oldWalletMetadata = _walletMetadata[_oldWalletAddress];
        require(
            _oldWalletMetadata.userId > 0 && _oldWalletMetadata.movedTo == address(0),
            "Microcredit: This user cannot be moved"
        );

        WalletMetadata storage _newWalletMetadata = _walletMetadata[_newWalletAddress];
        require(_newWalletMetadata.userId == 0, "Microcredit: Target wallet address is invalid");

        _oldWalletMetadata.movedTo = _newWalletAddress;
        _newWalletMetadata.userId = _oldWalletMetadata.userId;

        _walletList.add(_newWalletAddress);

        emit UserAddressChanged(_oldWalletAddress, _newWalletAddress);
    }

    /**
     * @notice Claim a loan
     *
     * @param _loanId Loan ID
     */
    function claimLoan(uint256 _loanId) external override nonReentrant whenNotPaused {
        _checkUserLoan(msg.sender, _loanId);

        WalletMetadata memory _metadata = _walletMetadata[msg.sender];
        User storage _user = _users[_metadata.userId];
        Loan storage _loan = _user.loans[_loanId];

        require(_loan.startDate == 0, "Microcredit: Loan already claimed");
        require(_loan.claimDeadline != 0, "Microcredit: Loan canceled");
        require(_loan.claimDeadline >= block.timestamp, "Microcredit: Loan expired");

        _loan.startDate = block.timestamp;

        _loan.lastComputedDebt = (_loan.amountBorrowed * (1e18 + _loan.dailyInterest / 100)) / 1e18;
        _loan.lastComputedDate = block.timestamp;

        _loan.tokenAmountBorrowed = _getTokenAmountFromExactCUSDOutput(
            _loan.tokenAddress,
            _loan.amountBorrowed
        );

        IERC20(_loan.tokenAddress).safeTransfer(msg.sender, _loan.tokenAmountBorrowed);

        emit LoanClaimed(msg.sender, _loanId);
    }

    /**
     * @notice Repay a loan
     *
     * @param _loanId Loan ID
     * @param _tokenRepaymentAmount Repayment amount
     */
    function repayLoan(uint256 _loanId, uint256 _tokenRepaymentAmount) external override nonReentrant {
        require(_tokenRepaymentAmount > 0, "Microcredit: Invalid amount");

        _checkUserLoan(msg.sender, _loanId);

        WalletMetadata memory _metadata = _walletMetadata[msg.sender];
        User storage _user = _users[_metadata.userId];
        Loan storage _loan = _user.loans[_loanId];

        require(_loan.startDate > 0, "Microcredit: Loan not claimed");
        require(_loan.lastComputedDebt > 0, "Microcredit: Loan has already been fully repayed");

        uint256 _currentDebt = _calculateCurrentDebt(_loan);

        uint256 _repaymentAmount = _getCUSDAmountFromExactTokenInput(_loan.tokenAddress, _tokenRepaymentAmount);

        if (_currentDebt < _repaymentAmount) {
            _repaymentAmount = _currentDebt;
            _tokenRepaymentAmount = _getTokenAmountFromExactCUSDOutput(_loan.tokenAddress, _repaymentAmount);
        }

        if (_loan.amountRepayed + _repaymentAmount <= _loan.amountBorrowed) {
            //all repaymentAmount should go to microcredit address
            IERC20(_loan.tokenAddress).safeTransferFrom(
                msg.sender,
                address(this),
                _tokenRepaymentAmount
            );
            _registerRepaymentToManager(_loan.managerAddress, _repaymentAmount);
        } else if (_loan.amountRepayed >= _loan.amountBorrowed) {
            //all repaymentAmount should go to revenue address
            IERC20(_loan.tokenAddress).safeTransferFrom(
                msg.sender,
                revenueAddress,
                _tokenRepaymentAmount
            );
        } else {
            //a part of the repayment should go to microcredit address and the rest should go to the revenue address

            uint256 _loanDiff = _loan.amountBorrowed - _loan.amountRepayed;
            uint256 _tokenLoanDiff = _getTokenAmountFromExactCUSDOutput(_loan.tokenAddress, _loanDiff);

            IERC20(_loan.tokenAddress).safeTransferFrom(msg.sender, address(this), _tokenLoanDiff);
            IERC20(_loan.tokenAddress).safeTransferFrom(
                msg.sender,
                revenueAddress,
                _tokenRepaymentAmount - _tokenLoanDiff
            );

            _registerRepaymentToManager(_loan.managerAddress, _loanDiff);
        }

        Repayment storage _repayment = _loan.repayments[_loan.repaymentsLength];
        _loan.repaymentsLength++;
        _repayment.date = block.timestamp;
        _repayment.amount = _repaymentAmount;
        _repayment.tokenAmount = _tokenRepaymentAmount;

        _loan.lastComputedDebt = _currentDebt - _repaymentAmount;
        _loan.amountRepayed += _repaymentAmount;
        _loan.tokenAmountRepayed += _tokenRepaymentAmount;

        uint256 _days = (block.timestamp - _loan.lastComputedDate) / 86400; //86400 = 1 day in seconds

        _loan.lastComputedDate = _loan.lastComputedDate + _days * 86400;

        if (_loan.lastComputedDebt == 0) {
//            if (address(microcreditManager) != address(0)) {
//                microcreditManager.addCompletedLoanToManager(_loan.managerAddress, msg.sender, _loanId);
//            }

            uint256 rewardAmount = (_loan.amountRepayed - _loan.amountBorrowed) * REWARD_MULTIPLIER;

            if (address(donationMiner) != address(0)) {
                donationMiner.donateVirtual(rewardAmount, msg.sender);
                donationMiner.donateVirtual(rewardAmount, _loan.managerAddress);
                donationMiner.donateVirtual(rewardAmount, DEFAULT_LENDER_ADDRESS);
            }
        }

        emit RepaymentAdded(msg.sender, _loanId, _repaymentAmount, _loan.lastComputedDebt);
    }

    /**
     * @notice Changes the borrowers manager address
     * @dev This method doesn't change anything on the contract state, it just emits events to be used by the off-chain system
     *
     * @param _borrowerAddresses address of the borrowers
     * @param _managerAddress address of the new manager
     */
    function changeBorrowerManager(address[] memory _borrowerAddresses, address _managerAddress)
        external
        override
        onlyMaintainers
    {
        //todo: allocate loan to manager; not the user
        uint256 _index;
        require(_managerList.contains(_managerAddress), "Microcredit: invalid manager address");

        for (_index = 0; _index < _borrowerAddresses.length; _index++) {
            require(
                _walletList.contains(_borrowerAddresses[_index]),
                "Microcredit: invalid borrower address"
            );

            User storage _user = _users[_walletMetadata[_borrowerAddresses[_index]].userId];

            if (_user.loans[_user.loansLength - 1].lastComputedDebt > 0) {
                _user.loans[_user.loansLength - 1].managerAddress = _managerAddress;
            }

            emit ManagerChanged(_borrowerAddresses[_index], _managerAddress);
        }
    }


    /**
     * @notice Adds a new token
     *
     * @param _tokenAddress address of the token to be added
     */
    function addToken(
        address _tokenAddress,
        address[] calldata _exchangeTokens,
        uint24[] calldata _exchangeTokensFees
    ) external override onlyOwner {
        require(
            _exchangeTokens.length == _exchangeTokensFees.length,
            "Microcredit: calldata information arity mismatch"
        );

        _tokenList.add(_tokenAddress);
        Token storage _token = _tokens[_tokenAddress];
        _token.active = true;

        if (_tokenAddress == address(cUSD)) {
            require(
                _exchangeTokens.length == 0 &&  _exchangeTokensFees.length == 0,
                "Microcredit: cUSD can't have exchangeTokens"
            );
        } else {
            require(
                _exchangeTokens.length == 1 && _exchangeTokens[0] == address(cUSD),
                "Microcredit: For the moment, just cUSD is accepted as exchangeToken"
            );

            uint256 _length = _exchangeTokensFees.length;
            for (uint256 _index = 0; _index < _length; _index++) {
                _token.exchangeTokensFees[_exchangeTokens[_index]] = _exchangeTokensFees[_index];
                _token.exchangeTokens.add(_exchangeTokens[_index]);

                require(
                    _getCUSDAmountFromExactTokenInput(_tokenAddress, 1e18) > 0,
                    "Microcredit: invalid exchangeToken"
                );
            }

            require(
                _token.exchangeTokens.contains(address(cUSD)),
                'Microcredit: exchangeToken to cUSD must be set'
            );
        }

        emit TokenAdded(_tokenAddress);
    }

    /**
     * @notice Adds a new token
     *
     * @param _tokenAddress address of the token to be added
     */
    function inactivateToken(address _tokenAddress) external override onlyOwner {
        require(_tokens[_tokenAddress].active == true, "Microcredit: Token is not active");

        _tokens[_tokenAddress].active = false;

        emit TokenRemoved(_tokenAddress);
    }

    /**
     * @notice Transfers an amount of an ERC20 from this contract to an address
     *
     * @param _token address of the ERC20 token
     * @param _to address of the receiver
     * @param _amount amount of the transaction
     */
    function transferERC20(
        IERC20 _token,
        address _to,
        uint256 _amount
    ) external override nonReentrant onlyOwner {
        _token.safeTransfer(_to, _amount);
    }

    function _checkUserLoan(address _userAddress, uint256 _loanId) internal view {
        WalletMetadata memory _metadata = _walletMetadata[_userAddress];

        require(
            _metadata.userId > 0 && _metadata.movedTo == address(0),
            "Microcredit: Invalid wallet address"
        );

        User storage _user = _users[_metadata.userId];

        require(_user.loansLength > _loanId, "Microcredit: Loan doesn't exist");
    }

    function _calculateCurrentDebt(Loan storage _loan) internal view returns (uint256) {
        if (_loan.lastComputedDebt == 0) {
            return 0;
        }

        uint256 _days = (block.timestamp - _loan.lastComputedDate) / 86400; //86400 = 1 day in seconds

        uint256 _currentDebt = _loan.lastComputedDebt;

        while (_days > 0) {
            _currentDebt = (_currentDebt * (1e18 + _loan.dailyInterest / 100)) / 1e18;
            _days--;
        }

        return _currentDebt;
    }

    function _addLoan(
        address _userAddress,
        address _tokenAddress,
        uint256 _amount,
        uint256 _period,
        uint256 _dailyInterest,
        uint256 _claimDeadline
    ) internal {
        require(_tokens[_tokenAddress].active == true, "Microcredit: invalid token");

        require(_claimDeadline > block.timestamp, "Microcredit: invalid claimDeadline");

        WalletMetadata storage _metadata = _walletMetadata[_userAddress];
        require(_metadata.movedTo == address(0), "Microcredit: The user has been moved");

        Manager storage _manager = _managers[msg.sender];

        require(
            _manager.lentAmount + _amount <= _manager.lentAmountLimit,
            "Microcredit: Manager don't have enough funds to borrow this amount"
        );

        if (_metadata.userId == 0) {
            _usersLength++;
            _metadata.userId = _usersLength;
            _walletList.add(_userAddress);
        }

        User storage _user = _users[_metadata.userId];

        uint256 _loansLength = _user.loansLength;

        if (_loansLength > 0) {
            Loan storage _previousLoan = _user.loans[_loansLength - 1];
            require(
                (_previousLoan.startDate > 0 && _previousLoan.lastComputedDebt == 0) || // loan claimed and fully paid
                    (_previousLoan.claimDeadline == 0), //loan canceled
                "Microcredit: The user already has an active loan"
            );
        }

        Loan storage _loan = _user.loans[_loansLength];
        _user.loansLength++;

        _loan.tokenAddress = _tokenAddress;
        _loan.amountBorrowed = _amount;
        _loan.period = _period;
        _loan.dailyInterest = _dailyInterest;
        _loan.claimDeadline = _claimDeadline;
        _loan.managerAddress = msg.sender;

        _manager.lentAmount += _amount;

        emit LoanAdded(
            _userAddress,
            _tokenAddress,
            _loansLength,
            _amount,
            _period,
            _dailyInterest,
            _claimDeadline
        );
    }

    function _cancelLoan(address _userAddress, uint256 _loanId) internal {
        _checkUserLoan(_userAddress, _loanId);

        WalletMetadata memory _metadata = _walletMetadata[_userAddress];
        User storage _user = _users[_metadata.userId];
        Loan storage _loan = _user.loans[_loanId];

        require(_loan.startDate == 0, "Microcredit: Loan already claimed");
        require(_loan.claimDeadline != 0, "Microcredit: Loan already canceled");

        _loan.claimDeadline = 0; //set claimDeadline to 0 to prevent claiming (cancel the loan)

        Manager storage _manager = _managers[_loan.managerAddress];

        _manager.lentAmount -= _loan.amountBorrowed;

        emit LoanCanceled(_userAddress, _loanId);
    }

    function _registerRepaymentToManager(
        address _managerAddress,
        uint256 _repaymentAmount
    ) internal {
        Manager storage _manager = _managers[_managerAddress];
        if (_managerAddress != address(0)) {
            if (_manager.lentAmount > _repaymentAmount) {
                _manager.lentAmount -= _repaymentAmount;
            } else {
                _manager.lentAmount = 0;
            }
        }
    }

    function _getCUSDAmountFromExactTokenInput(address _tokenAddress, uint256 _tokenAmount) public returns(uint256) {
        if (_tokenAddress == address(cUSD) || _tokenAmount == 0) {
            return _tokenAmount;
        } else {
            Token storage _token = _tokens[_tokenAddress];
            return uniswapQuoter.quoteExactInput(
                abi.encodePacked(_tokenAddress, _token.exchangeTokensFees[address(cUSD)], address(cUSD)), _tokenAmount
            );
        }
    }

    function _getTokenAmountFromExactCUSDOutput(address _tokenAddress, uint256 _cUSDAmount) public returns(uint256) {
        if (_tokenAddress == address(cUSD) || _cUSDAmount == 0) {
            return _cUSDAmount;
        } else {
            Token storage _token = _tokens[_tokenAddress];
            return uniswapQuoter.quoteExactOutput(
                abi.encodePacked(address(cUSD), _token.exchangeTokensFees[address(cUSD)], _tokenAddress), _cUSDAmount
            );
        }
    }

    // OWNER METHODS FOR EMERGENCY SITUATION
    function setManagers(
        address[] calldata _userAddresses,
        uint256[] calldata _loanIds,
        address[] calldata _managersAddresses
    ) external onlyOwner {
        require(
            _userAddresses.length == _managersAddresses.length,
            "Microcredit: calldata information arity mismatch"
        );

        uint256 _index;

        for (_index = 0; _index < _userAddresses.length; _index++) {
            WalletMetadata memory _metadata = _walletMetadata[_userAddresses[_index]];

            _users[_metadata.userId].loans[_loanIds[_index]].managerAddress = _managersAddresses[
                        _index
                ];
        }
    }

    /**
     * @notice Used by owner to fix when an active loan has wrong params
     *
     * @param _currentLastComputedDate   used as a control mechanism
                                            - if this value doesn't match the loan current lastComputedDate,
                                            it means that the user has made a repayment in the mean time
                                            so this call is not valid any more
     */
    function editLoan(
        address _userAddress,
        uint256 _loanId,
        uint256 _currentLastComputedDate,
        uint256 _newPeriod,
        uint256 _newDailyInterest,
        uint256 _newLastComputedDebt,
        uint256 _newLastComputedDate
    ) external onlyOwner {
        _checkUserLoan(_userAddress, _loanId);

        WalletMetadata memory _metadata = _walletMetadata[_userAddress];
        User storage _user = _users[_metadata.userId];
        Loan storage _loan = _user.loans[_loanId];

        require(_loan.startDate > 0, "Microcredit: Loan is not active, use cancel method instead");

        require(
            _loan.lastComputedDate == _currentLastComputedDate,
            "Microcredit: The user has just made a repayment"
        );

        require(
            _newLastComputedDate >= _loan.startDate && _newLastComputedDate <= block.timestamp,
            "Microcredit: Invalid newLastComputedDate"
        );

        _loan.period = _newPeriod;
        _loan.dailyInterest = _newDailyInterest;
        _loan.lastComputedDebt = _newLastComputedDebt;
        _loan.lastComputedDate = _newLastComputedDate;

        emit LoanEdited(
            _userAddress,
            _loanId,
            _newPeriod,
            _loan.claimDeadline,
            _newDailyInterest,
            _newLastComputedDebt,
            _newLastComputedDate
        );
    }

    function initV2(uint256 _from, uint256 _to) external onlyOwner {
        uint256 _userId;
        uint256 _loanId;

        _to  = _to < _usersLength ? _to : _usersLength;
        for (_userId = _from; _userId <= _to; _userId++) {
            for (_loanId = 0; _loanId < _users[_userId].loansLength; _loanId++) {
                _users[_userId].loans[_loanId].tokenAddress = address(cUSD);
                _users[_userId].loans[_loanId].tokenAmountBorrowed = _users[_userId].loans[_loanId].amountBorrowed;
                _users[_userId].loans[_loanId].tokenAmountRepayed = _users[_userId].loans[_loanId].amountRepayed;
            }
        }

        if (!_tokenList.contains(address(cUSD))) {
            _tokenList.add(address(cUSD));
            _tokens[address(cUSD)].active = true;
            emit TokenAdded(address(cUSD));
        }
    }
}
